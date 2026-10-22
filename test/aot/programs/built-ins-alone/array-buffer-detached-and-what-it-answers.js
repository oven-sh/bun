const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.detached;
console.log(typeof result, result);
