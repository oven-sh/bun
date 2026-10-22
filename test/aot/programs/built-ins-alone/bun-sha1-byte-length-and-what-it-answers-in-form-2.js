const subject = new Bun.SHA1();
const result = subject.byteLength;
console.log(typeof result, result + 1);
