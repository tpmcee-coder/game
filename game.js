const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a20); // خلفية زرقاء داكنة جداً ولكن أفتح قليلاً
scene.fog = new THREE.FogExp2(0x0a0a20, 0.02); // ضباب أزرق داكن أقل كثافة (مدى رؤية أوسع)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight); // تعيين الحجم الأولي لملء الشاشة

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // إضاءة محيطة معتدلة
scene.add(ambientLight);
const flashlight = new THREE.SpotLight(0xffffff, 8, 40, Math.PI / 6, 0.5); // كشاف أقوى بمدى أبعد
camera.add(flashlight);
flashlight.target = new THREE.Object3D();
camera.add(flashlight.target);
flashlight.target.position.set(0, 0, -1);
scene.add(camera);

const wallGeo = new THREE.BoxGeometry(2, 4, 2);
const wallMat = new THREE.MeshPhongMaterial({ color: 0x555555 }); // جدران رمادية أوضح
const floorMat = new THREE.MeshPhongMaterial({ color: 0x111133 }); // أرضية زرقاء داكنة أوضح

const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

let keyMesh, exitMesh, monsterMesh;
let hasKey = false;
let timeLeft = 300;
let maze = [];
let timerInterval;

// Global controlling variables
let gameStarted = false;
let deviceType = 'pc';
let keys = {};
let pitch = 0;
let yaw = 0;

let joystickActive = false;
let joystickVec = { x: 0, y: 0 };
let activeTouches = {}; // Maps touch.identifier to touch type ('joystick' or 'look') and its state

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

window.addEventListener('mousemove', e => {
    if (gameStarted && deviceType === 'pc' && document.pointerLockElement) {
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
        
        camera.rotation.order = "YXZ";
        camera.rotation.set(pitch, yaw, 0);
    }
});
window.addEventListener('click', () => {
    if (gameStarted && deviceType === 'pc' && !document.pointerLockElement) {
        renderer.domElement.requestPointerLock();
    }
});

// Function to create the monster mesh
function createMonster() {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 1.5), new THREE.MeshPhongMaterial({ color: 0x800000 })); // جسم أحمر داكن
    const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    const eye2 = eye1.clone();
    eye1.position.set(-0.4, 0.8, 0.8);
    eye2.position.set(0.4, 0.8, 0.8);
    
    const monsterGroup = new THREE.Group();
    monsterGroup.add(body, eye1, eye2);
    monsterGroup.position.y = 1.25; // Base of monster on the floor
    return monsterGroup;
}


// Maze generation algorithm (Recursive Backtracker)
function generateMaze(width, height) {
    const newMaze = Array(height).fill(null).map(() => Array(width).fill(1)); // All walls initially
    const visited = Array(height).fill(null).map(() => Array(width).fill(false));
    const stack = [];

    // Helper to get unvisited neighbors
    function getNeighbors(x, y) {
        const neighbors = [];
        const directions = [[2, 0], [-2, 0], [0, 2], [0, -2]];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[ny][nx]) {
                neighbors.push({ x: nx, y: ny, wallX: x + dx / 2, wallY: y + dy / 2 });
            }
        }
        return neighbors;
    }

    let startX = Math.floor(Math.random() * (width / 2)) * 2 + 1;
    let startY = Math.floor(Math.random() * (height / 2)) * 2 + 1;
    newMaze[startY][startX] = 0;
    visited[startY][startX] = true;
    stack.push({ x: startX, y: startY });

    while (stack.length > 0) {
        const current = stack[stack.length - 1];
        const neighbors = getNeighbors(current.x, current.y);

        if (neighbors.length > 0) {
            const next = neighbors[Math.floor(Math.random() * neighbors.length)];
            newMaze[next.y][next.x] = 0;
            newMaze[next.wallY][next.wallX] = 0;
            visited[next.y][next.x] = true;
            stack.push({ x: next.x, y: next.y });
        } else {
            stack.pop();
        }
    }

    let pathCells = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            if (newMaze[r][c] === 0) {
                pathCells.push({ x: c, z: r });
            }
        }
    }

    let playerPosIndex = Math.floor(Math.random() * pathCells.length);
    let playerCell = pathCells[playerPosIndex];
    pathCells.splice(playerPosIndex, 1);

    let keyPosIndex = Math.floor(Math.random() * pathCells.length);
    let keyCell = pathCells[keyPosIndex];
    newMaze[keyCell.z][keyCell.x] = 'K';
    pathCells.splice(keyPosIndex, 1);

    let exitCell;
    const minDistanceSquared = 5 * 5 * 2 * 2;
    let attempts = 0;
    const maxAttempts = 100;
    do {
        if (pathCells.length === 0) {
            console.warn("Could not place exit far enough. Placing near key/player.");
            exitCell = keyCell;
            break;
        }
        let exitPosIndex = Math.floor(Math.random() * pathCells.length);
        exitCell = pathCells[exitPosIndex];
        
        const distToPlayerSquared = Math.pow(exitCell.x * 2 - playerCell.x * 2, 2) + Math.pow(exitCell.z * 2 - playerCell.z * 2, 2);
        const distToKeySquared = Math.pow(exitCell.x * 2 - keyCell.x * 2, 2) + Math.pow(exitCell.z * 2 - keyCell.z * 2, 2);
        
        if (distToPlayerSquared > minDistanceSquared && distToKeySquared > minDistanceSquared) {
             newMaze[exitCell.z][exitCell.x] = 'E';
             break;
        }
        attempts++;
        if (attempts > maxAttempts && pathCells.length > 0) {
            console.warn("Failed to find distant exit after many attempts. Placing a random one.");
            newMaze[exitCell.z][exitCell.x] = 'E';
            break;
        }
    } while (true);

    return { maze: newMaze, startPos: { x: playerCell.x * 2, z: playerCell.z * 2 } };
}

function clearMaze() {
    const objectsToRemove = [];
    scene.children.forEach(object => {
        if (object.isMesh && (object.geometry.type === 'BoxGeometry' || object.geometry.type === 'TorusGeometry')) {
            objectsToRemove.push(object);
        }
    });
    objectsToRemove.forEach(object => {
        object.geometry.dispose();
        object.material.dispose();
        scene.remove(object);
    });
}

const defaultSettings = {
    brightness: 1.0
};
let gameSettings = { ...defaultSettings };

function loadSettings() {
    const storedSettings = localStorage.getItem('gameSettings');
    if (storedSettings) {
        try {
            gameSettings = { ...defaultSettings, ...JSON.parse(storedSettings) };
        } catch (e) {
            console.error("Error parsing settings from localStorage", e);
            gameSettings = { ...defaultSettings };
        }
    }
}

function saveSettings() {
    localStorage.setItem('gameSettings', JSON.stringify(gameSettings));
}

function applySettings() {
    ambientLight.intensity = gameSettings.brightness * 0.4; // تعديل الإضاءة المحيطة بناءً على السطوع
    flashlight.intensity = gameSettings.brightness * 8; // تعديل قوة الكشاف بناءً على السطوع
    const brightnessSlider = document.getElementById('brightness-slider');
    if (brightnessSlider) { // Check if slider exists before setting value
        brightnessSlider.value = gameSettings.brightness;
    }
}

function initGame() {
    clearMaze();
    
    const mazeData = generateMaze(11, 11);
    maze = mazeData.maze;
    const initialPlayerX = mazeData.startPos.x;
    const initialPlayerZ = mazeData.startPos.z;

    maze.forEach((row, z) => {
        row.forEach((cell, x) => {
            if (cell === 1) {
                const wall = new THREE.Mesh(wallGeo, wallMat);
                wall.position.set(x * 2, 2, z * 2); // Walls centered at (x*2, z*2)
                scene.add(wall);
            } else if (cell === 'K') {
                keyMesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0xff0000 }));
                keyMesh.position.set(x * 2, 1, z * 2);
                scene.add(keyMesh);
            } else if (cell === 'E') {
                exitMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 0.1), new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 }));
                exitMesh.position.set(x * 2, 2, z * 2);
                scene.add(exitMesh);
            }
        });
    });

    hasKey = false;
    timeLeft = 300;
    document.getElementById('status').innerText = "المفتاح: لم يتم العثور عليه";
    document.getElementById('status').style.color = "#ff0000";
    document.getElementById('timer').innerText = `الوقت المتبقي: 05:00`;
    
    camera.position.set(initialPlayerX, 1.6, initialPlayerZ); // Player starts at center of a path cell
    pitch = 0;
    yaw = 0;
    camera.rotation.set(pitch, yaw, 0);
    
    applySettings();

    // Ensure timer is stopped if game is not started yet, or reset for a new game
    if (timerInterval) clearInterval(timerInterval);
    // Hide joystick if game is reset or not started
    if (document.getElementById('joystick-container')) {
        document.getElementById('joystick-container').style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    applySettings();

    document.getElementById('pc-button').addEventListener('click', () => initControls('pc'));
    document.getElementById('mobile-button').addEventListener('click', () => initControls('mobile'));

    document.getElementById('open-settings-button').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'block';
        gameStarted = false;
        if (timerInterval) clearInterval(timerInterval);
    });
    document.getElementById('close-settings-button').addEventListener('click', () => {
        document.getElementById('settings-modal').style.display = 'none';
        if (deviceType === 'pc') renderer.domElement.requestPointerLock();
        gameStarted = true;
        startTimer(); // Restart timer when closing settings
    });
    document.getElementById('brightness-slider').addEventListener('input', (event) => {
        gameSettings.brightness = parseFloat(event.target.value);
        applySettings();
        saveSettings();
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    initGame(); // Initial game setup
});

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (gameStarted && timeLeft > 0) {
            timeLeft--;
            const mins = Math.floor(timeLeft / 60);
            const secs = timeLeft % 60;
            document.getElementById('timer').innerText = `الوقت المتبقي: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        } else if (gameStarted && timeLeft <= 0) {
            clearInterval(timerInterval);
            alert("انتهى الوقت! لم تتمكن من الهروب.");
            gameStarted = false;
            document.getElementById('setup-screen').style.display = 'flex'; // Show setup screen
            document.getElementById('ui').style.display = 'none';
            document.getElementById('joystick-container').style.display = 'none';
            initGame(); // Reset game state for a new game
        }
    }, 1000);
}


function initControls(type) {
    deviceType = type;
    gameStarted = true;
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('ui').style.display = 'block';
    
    startTimer();

    if (type === 'pc') {
        renderer.domElement.requestPointerLock();
    } else {
        document.getElementById('joystick-container').style.display = 'block';
        setupMobileEvents();
    }
}

// Function to get the bounding rectangle for joystick base, ensuring it's up-to-date
function getJoystickBaseRect() {
    const base = document.getElementById('joystick-base');
    // Ensure base exists and is visible before getting rect
    if (base && getComputedStyle(base).display !== 'none') {
        return base.getBoundingClientRect();
    }
    return null;
}

function setupMobileEvents() {
    const stick = document.getElementById('joystick-stick');
    
    // Clear previous event listeners if setupMobileEvents is called multiple times
    // (e.g., after game reset, though typically it's called once)
    window.removeEventListener('touchstart', handleTouchStart, { passive: false });
    window.removeEventListener('touchmove', handleTouchMove, { passive: false });
    window.removeEventListener('touchend', handleTouchEnd, { passive: false });
    window.removeEventListener('touchcancel', handleTouchEnd, { passive: false }); // handle touch leaving screen

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    function handleTouchStart(e) {
        e.preventDefault(); // Prevent default browser actions like scrolling/zooming
        const baseRect = getJoystickBaseRect();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            
            // Determine if touch is for joystick or camera look
            if (baseRect && touch.clientX >= baseRect.left && touch.clientX <= baseRect.right &&
                touch.clientY >= baseRect.top && touch.clientY <= baseRect.bottom) {
                // Touch is on joystick area
                activeTouches[touch.identifier] = { type: 'joystick', touchId: touch.identifier };
                joystickActive = true; // Set global joystick active flag
            } else if (e.target.closest('#ui') === null && e.target.closest('#settings-button-container') === null) {
                // Touch is for camera look, not on UI elements
                activeTouches[touch.identifier] = { type: 'look', touchId: touch.identifier, lastX: touch.clientX, lastY: touch.clientY };
            }
        }
    }

    function handleTouchMove(e) {
        e.preventDefault(); // Prevent default browser actions
        const baseRect = getJoystickBaseRect(); // Recalculate on move for robustness

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const touchInfo = activeTouches[touch.identifier];

            if (touchInfo) {
                if (touchInfo.type === 'joystick' && baseRect) {
                    const centerX = baseRect.left + baseRect.width / 2;
                    const centerY = baseRect.top + baseRect.height / 2;

                    let dx = touch.clientX - centerX;
                    let dy = touch.clientY - centerY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = 50;

                    if (dist > maxDist) {
                        dx *= maxDist / dist;
                        dy *= maxDist / dist;
                    }

                    stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
                    joystickVec.x = dx / maxDist;
                    joystickVec.y = dy / maxDist;

                } else if (touchInfo.type === 'look') {
                    const movementX = touch.clientX - touchInfo.lastX;
                    const movementY = touch.clientY - touchInfo.lastY;
                    
                    yaw -= movementX * 0.005;
                    pitch -= movementY * 0.005;
                    pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, pitch));
                    camera.rotation.set(pitch, yaw, 0);

                    touchInfo.lastX = touch.clientX;
                    touchInfo.lastY = touch.clientY;
                }
            }
        }
    }

    function handleTouchEnd(e) {
        e.preventDefault(); // Prevent default browser actions

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const touchInfo = activeTouches[touch.identifier];

            if (touchInfo) {
                if (touchInfo.type === 'joystick') {
                    // Reset joystick state if this was the joystick touch
                    stick.style.transform = 'translate(-50%, -50%)';
                    joystickVec.x = 0;
                    joystickVec.y = 0;
                    joystickActive = false; // Reset global flag
                }
                delete activeTouches[touch.identifier];
            }
        }
        // Re-evaluate joystickActive based on remaining touches
        joystickActive = Object.values(activeTouches).some(t => t.type === 'joystick');
        if (!joystickActive) {
            joystickVec = {x: 0, y: 0};
            stick.style.transform = 'translate(-50%, -50%)';
        }
    }
}


function checkCollision(newPos) {
    const playerHalfSize = 0.5; // Player is a cube of side length 1 unit (radius 0.5)
    const wallHalfSize = 1.0;   // Walls are 2x4x2, so half width/depth is 1.0
    const gridCellSize = 2;     // Each cell takes up 2 units in world space

    // Calculate the range of grid cells the player's AABB (Axis-Aligned Bounding Box) might overlap
    const minPlayerGridX = Math.floor((newPos.x - playerHalfSize) / gridCellSize);
    const maxPlayerGridX = Math.floor((newPos.x + playerHalfSize) / gridCellSize);
    const minPlayerGridZ = Math.floor((newPos.z - playerHalfSize) / gridCellSize);
    const maxPlayerGridZ = Math.floor((newPos.z + playerHalfSize) / gridCellSize);

    // Iterate through all potential grid cells the player's bounding box might touch
    for (let gridZ = minPlayerGridZ; gridZ <= maxPlayerGridZ; gridZ++) {
        for (let gridX = minPlayerGridX; gridX <= maxPlayerGridX; gridX++) {
            // Check bounds of the maze array
            if (gridZ < 0 || gridZ >= maze.length || gridX < 0 || gridX >= maze[0].length) {
                return true; // Collision with outer boundary of the maze
            }

            const cell = maze[gridZ][gridX];

            // If the cell is a wall or a locked exit, check for specific AABB overlap
            if (cell === 1 || (cell === 'E' && !hasKey)) {
                // World coordinates of the center of this maze cell (where the wall/exit object is)
                const cellWorldX = gridX * gridCellSize;
                const cellWorldZ = gridZ * gridCellSize;

                // Check for AABB overlap between player and the blocking cell
                const overlapX = (newPos.x - playerHalfSize < cellWorldX + wallHalfSize) && (newPos.x + playerHalfSize > cellWorldX - wallHalfSize);
                const overlapZ = (newPos.z - playerHalfSize < cellWorldZ + wallHalfSize) && (newPos.z + playerHalfSize > cellWorldZ - wallHalfSize);

                if (overlapX && overlapZ) {
                    return true; // Collision detected
                }
            }
        }
    }
    
    return false; // No collision
}

function update() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();
    
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const speed = 0.08;
    let nextPos = camera.position.clone();

    if (deviceType === 'pc') {
        if (keys['KeyW']) nextPos.addScaledVector(forward, speed);
        if (keys['KeyS']) nextPos.addScaledVector(forward, -speed);
        if (keys['KeyA']) nextPos.addScaledVector(right, -speed);
        if (keys['KeyD']) nextPos.addScaledVector(right, speed);
    } else {
        // Joystick movement: joystickVec.y is forward/backward, joystickVec.x is left/right
        nextPos.addScaledVector(forward, -joystickVec.y * speed); // -joystickVec.y because joystick Y-axis is inverted
        nextPos.addScaledVector(right, joystickVec.x * speed);
    }
    
    // Check collision for the full intended movement first
    if (!checkCollision(nextPos)) {
        camera.position.copy(nextPos);
    } else {
        // If full movement is blocked, try sliding along X axis
        let nextPosX = camera.position.clone();
        nextPosX.x = nextPos.x;
        if (!checkCollision(nextPosX)) {
            camera.position.x = nextPosX.x;
        }

        // Then try sliding along Z axis (if X slide was also blocked or successful)
        let nextPosZ = camera.position.clone();
        nextPosZ.z = nextPos.z;
        if (!checkCollision(nextPosZ)) {
            camera.position.z = nextPosZ.z;
        }
    }

    camera.position.y = 1.6;

    if (!hasKey && keyMesh && camera.position.distanceTo(keyMesh.position) < 1) {
        hasKey = true;
        scene.remove(keyMesh);
        keyMesh = null;
        if (exitMesh) {
            exitMesh.material.color.set(0x00ff00);
            exitMesh.material.opacity = 0.8;
        }
        document.getElementById('status').innerText = "المفتاح: تم العثور عليه! المخرج مفتوح الآن";
        document.getElementById('status').style.color = "#00ff00";
    }

    if (hasKey && exitMesh && camera.position.distanceTo(exitMesh.position) < 1.2) {
        clearInterval(timerInterval);
        alert("مبروك! لقد فتحت الباب ونجوت!");
        gameStarted = false;
        document.getElementById('setup-screen').style.display = 'flex';
        document.getElementById('ui').style.display = 'none';
        document.getElementById('joystick-container').style.display = 'none';
        initGame();
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (gameStarted) {
        update();
    }
    renderer.render(scene, camera);
}
animate();
