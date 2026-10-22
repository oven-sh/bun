const first = new Uint8Array(0);
const result = Buffer(first);
console.log(result instanceof Buffer, result.length);
