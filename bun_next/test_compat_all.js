const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

console.log('--- Test Modules Compat ---');

// 1. Test Path
const fullPath = path.join('user', 'local', 'bin', 'test.js');
console.log('Path Join:', fullPath);
console.log('Extname:', path.extname(fullPath));

// 2. Test FS
const testFile = 'compat_test.txt';
const content = 'Data for compat test';
fs.writeFileSync(testFile, content);
const read = fs.readFileSync(testFile);
console.log('FS Read:', read);

// 3. Test Crypto
const hash = crypto.createHash('sha256').update(content).digest('hex');
console.log('SHA256 Hash:', hash);

const bytes = crypto.randomBytes(16);
console.log('Random Bytes length:', bytes.length);

if (read === content && hash.length === 64) {
    console.log('✅ TEST COMPAT RÉUSSI !');
}

// Cleanup
fs.unlinkSync(testFile);
