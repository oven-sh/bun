const { Buffer } = require('node:buffer');
const util = require('node:util');
const fs = require('node:fs');

console.log('--- Test Buffer & Util ---');

// 1. Test Buffer
const buf = Buffer.from('Hello Bun-Elixir');
console.log('Buffer content:', buf.toString());
console.log('Buffer length:', buf.length);
console.log('Is Buffer?', Buffer.isBuffer(buf));

// 2. Test Util Format
const formatted = util.format('Hello %s, you have %d items', 'Alpha', 42);
console.log('Formatted:', formatted);

// 3. Test Promisify with FS
const readFileAsync = util.promisify(fs.readFile);

const testFile = 'util_test.txt';
fs.writeFileSync(testFile, 'Promisify Works!');

readFileAsync(testFile)
  .then(data => {
    console.log('Promisified Read:', data);
    if (data === 'Promisify Works!') {
        console.log('✅ TEST BUFFER & UTIL RÉUSSI !');
    }
    fs.unlinkSync(testFile);
  })
  .catch(err => {
    console.log('❌ Erreur Promisify:', err);
  });
