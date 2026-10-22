const subject = new Uint8Array([1, 2, 3]);
const result = subject.set(1.5, 2);
console.log(typeof result, result === undefined);
