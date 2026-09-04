const fs = require('node:fs');

const path = 'test-fs.txt';
fs.writeFileSync(path, 'test data');
const data = fs.readFileSync(path);

if (data !== 'test data') {
    throw new Error('FS Read Mismatch');
}

fs.unlinkSync(path);
console.log('FS OK');
