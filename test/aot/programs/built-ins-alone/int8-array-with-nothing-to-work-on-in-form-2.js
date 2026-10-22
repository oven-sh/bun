const first = new ArrayBuffer(0);
const result = new Int8Array(first, 0);
console.log(result instanceof Int8Array, result.length);
