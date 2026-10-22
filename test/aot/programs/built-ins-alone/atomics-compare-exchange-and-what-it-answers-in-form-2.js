const first = new BigInt64Array([1n, 2n, 3n]);
const result = Atomics.compareExchange(first, 2, 5n, 5n);
console.log(typeof result, result + 1n);
