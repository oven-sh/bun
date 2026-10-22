const subject = new Bun.SHA512_256();
const result = subject.byteLength;
console.log(typeof result, result + 1);
