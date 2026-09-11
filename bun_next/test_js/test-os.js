const assert = require('node:assert');
const os = require('node:os');

// Test minimal
if (os.platform() !== 'win32' && os.platform() !== 'linux' && os.platform() !== 'darwin') {
    throw new Error('Invalid platform: ' + os.platform());
}

console.log('Platform OK');
