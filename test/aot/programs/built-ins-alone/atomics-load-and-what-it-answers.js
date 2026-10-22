const first = new Int16Array([1, 2, 3]);
const result = Atomics.load(first, 2);
console.log(typeof result, result + 1);
