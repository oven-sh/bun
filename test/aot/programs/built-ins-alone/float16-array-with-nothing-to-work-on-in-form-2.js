const first = new ArrayBuffer(0);
const result = new Float16Array(first, 0);
console.log(result instanceof Float16Array, result.length);
