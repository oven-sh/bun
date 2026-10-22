const first = new ArrayBuffer(0);
const result = new BigUint64Array(first, 0);
console.log(result instanceof BigUint64Array, result.length);
