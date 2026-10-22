const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = new BigUint64Array(first, 0);
console.log(result instanceof BigUint64Array, result.length, typeof result[0], result[0] + 1n);
