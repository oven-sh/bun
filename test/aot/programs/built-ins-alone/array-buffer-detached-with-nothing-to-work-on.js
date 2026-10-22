const subject = new ArrayBuffer(0);
const result = subject.detached;
console.log(typeof result, result);
