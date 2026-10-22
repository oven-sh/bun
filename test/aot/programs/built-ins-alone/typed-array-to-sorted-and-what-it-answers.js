const subject = new Uint8Array([1, 2, 3]);
const result = subject.toSorted();
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
