const subject = new Uint8Array([1, 2, 3]);
const first = new Uint8Array([1, 2, 3]);
const result = subject.set(first, 0);
console.log(typeof result, result === undefined);
