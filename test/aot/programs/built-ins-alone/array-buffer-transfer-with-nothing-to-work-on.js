const subject = new ArrayBuffer(0);
const result = subject.transfer(1);
console.log(result instanceof ArrayBuffer, result.byteLength);
