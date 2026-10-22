const first = new Uint8Array(0);
const result = Buffer.copyBytesFrom(first, 2.5, 3.5);
console.log(result instanceof Buffer, result.length);
