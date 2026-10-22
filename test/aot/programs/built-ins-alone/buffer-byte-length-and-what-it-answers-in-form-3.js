const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Buffer.byteLength(first);
console.log(typeof result, result + 1);
