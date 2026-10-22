const subject = new SharedArrayBuffer(8, { maxByteLength: 16 });
const result = subject.growable;
console.log(typeof result, result);
