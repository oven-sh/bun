const first = new ArrayBuffer(0);
const result = new Int16Array(first, 0);
console.log(result instanceof Int16Array, result.length);
