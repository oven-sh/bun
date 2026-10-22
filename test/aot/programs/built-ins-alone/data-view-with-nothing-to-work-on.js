const first = new ArrayBuffer(0);
const result = new DataView(first, 0);
console.log(result instanceof DataView, result.byteLength, result.byteOffset);
