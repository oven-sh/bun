const subject = new Uint8Array([1, 2, 3]);
const result = subject.slice(1, 2);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
