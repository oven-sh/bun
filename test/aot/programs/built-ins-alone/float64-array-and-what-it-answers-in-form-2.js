const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new Float64Array(first, 0);
console.log(result instanceof Float64Array, result.length, typeof result[0], result[0] + 1, 1 / result[0]);
