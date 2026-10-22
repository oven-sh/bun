const first = new ArrayBuffer(0);
const result = new Float64Array(first, 0);
console.log(result instanceof Float64Array, result.length);
