const subject = new Uint8Array([1, 2, 3]);
const result = subject.reverse();
console.log(result === subject, subject instanceof Uint8Array, subject.length, typeof subject[0], subject[0] + 1);
console.log(typeof subject[1], subject[1] + 1);
