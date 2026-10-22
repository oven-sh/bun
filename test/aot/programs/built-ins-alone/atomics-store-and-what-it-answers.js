const first = new Int16Array([1, 2, 3]);
const result = Atomics.store(first, 2, 3);
console.log(typeof result, result + 1);
