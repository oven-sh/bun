const first = new BigInt64Array([1n, 2n, 3n]);
const result = Atomics.exchange(first, 2, 5n);
console.log(typeof result, result + 1n, first instanceof BigInt64Array, first.length);
console.log(typeof first[0], first[0] + 1n, typeof first[1], first[1] + 1n);
