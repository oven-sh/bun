const subject = new SharedArrayBuffer(0);
const result = subject.growable;
console.log(typeof result, result);
