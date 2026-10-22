const subject = new Bun.MD4();
const result = subject.byteLength;
console.log(typeof result, result + 1);
