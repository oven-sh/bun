const first = new Uint8Array(0);
const result = Buffer.from(first);
console.log(result instanceof Buffer, result.length);
