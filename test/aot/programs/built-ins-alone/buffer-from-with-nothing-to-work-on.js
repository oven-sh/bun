const first = new ArrayBuffer(0);
const result = Buffer.from(first, "-");
console.log(result instanceof Buffer, result.length);
