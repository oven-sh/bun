const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Buffer(first, "text", "text");
console.log(result instanceof Buffer, result.length);
