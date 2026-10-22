const first = new ArrayBuffer(0);
const result = new Int32Array(first, 0);
console.log(result instanceof Int32Array, result.length);
