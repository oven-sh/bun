const subject = new Bun.SHA224();
const result = subject.byteLength;
console.log(typeof result, result + 1);
