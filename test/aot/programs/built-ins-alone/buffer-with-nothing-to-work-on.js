const first = new ArrayBuffer(0);
const result = Buffer(first, "-");
console.log(result instanceof Buffer, result.length);
