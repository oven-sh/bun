const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new DataView(first, 2, 3);
console.log(result instanceof DataView, result.byteLength, result.byteOffset);
