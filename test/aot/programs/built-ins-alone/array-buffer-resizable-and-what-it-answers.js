const subject = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.resizable;
console.log(typeof result, result);
