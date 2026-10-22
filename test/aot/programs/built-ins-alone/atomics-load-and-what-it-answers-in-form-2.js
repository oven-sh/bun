const first = new BigInt64Array([1n, 2n, 3n]);
const result = Atomics.load(first, 2);
console.log(typeof result, result + 1n);
