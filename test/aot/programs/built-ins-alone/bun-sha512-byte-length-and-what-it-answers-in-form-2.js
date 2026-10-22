const subject = new Bun.SHA512();
const result = subject.byteLength;
console.log(typeof result, result + 1);
