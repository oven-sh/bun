const first = new Int16Array([1, 2, 3]);
const result = Atomics.compareExchange(first, 2, 3, 4);
console.log(typeof result, result + 1, first instanceof Int16Array, first.length);
console.log(typeof first[0], first[0] + 1, typeof first[1], first[1] + 1);
