const first = new Uint8Array([1, 2, 3]);
const result = new Int16Array(first);
console.log(result instanceof Int16Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
