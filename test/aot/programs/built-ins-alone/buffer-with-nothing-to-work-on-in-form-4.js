const first = new Uint8Array(0);
const result = new Buffer(first);
console.log(result instanceof Buffer, result.length);
