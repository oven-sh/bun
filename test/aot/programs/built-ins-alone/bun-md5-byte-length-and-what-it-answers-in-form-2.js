const subject = new Bun.MD5();
const result = subject.byteLength;
console.log(typeof result, result + 1);
