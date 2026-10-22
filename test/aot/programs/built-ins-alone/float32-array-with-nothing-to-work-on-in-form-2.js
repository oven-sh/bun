const first = new ArrayBuffer(0);
const result = new Float32Array(first, 0);
console.log(result instanceof Float32Array, result.length);
