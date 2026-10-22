const subject = new Uint8Array([1, 2, 3]);
const result = subject.setFromBase64("an");
console.log(typeof result, Object.keys(result).join(), typeof result.read, result.read + 1);
console.log(typeof result.written, result.written + 1, subject instanceof Uint8Array, subject.length);
console.log(typeof subject[0], subject[0] + 1, typeof subject[1], subject[1] + 1);
