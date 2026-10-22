const first = new DataView(new ArrayBuffer(16));
const result = Buffer.copyBytesFrom(first, 16, 3.5);
console.log(result instanceof Buffer, result.length);
