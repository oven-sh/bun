const table = {};
for (let i = 0; i < 4; i++) table['k' + i] = { a: i };
const value = Bun.CryptoHasher.hash('md5', 'a');
let sum = 0;
for (let i = 0; i < 4; i++) sum += table['k' + i].a;
console.log('SAID ' + sum + JSON.stringify(value).slice(0, 15));
