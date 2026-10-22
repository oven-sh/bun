const first = new ArrayBuffer(0);
const result = new Buffer(first, "-");
console.log(result instanceof Buffer, result.length);
