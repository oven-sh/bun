const first = new ArrayBuffer(0);
const result = new BigInt64Array(first, 0);
console.log(result instanceof BigInt64Array, result.length);
