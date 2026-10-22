const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new Int32Array(first, 0);
console.log(result instanceof Int32Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
console.log(typeof result[1], result[1] + 1, 1 / result[1]);
