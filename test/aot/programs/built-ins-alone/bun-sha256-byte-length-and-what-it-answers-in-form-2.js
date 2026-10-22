const subject = new Bun.SHA256();
const result = subject.byteLength;
console.log(typeof result, result + 1);
