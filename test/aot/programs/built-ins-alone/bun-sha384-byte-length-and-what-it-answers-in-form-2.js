const subject = new Bun.SHA384();
const result = subject.byteLength;
console.log(typeof result, result + 1);
