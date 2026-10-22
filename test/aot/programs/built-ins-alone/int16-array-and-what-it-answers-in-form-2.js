const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new Int16Array(first, 2, 3);
console.log(result instanceof Int16Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
