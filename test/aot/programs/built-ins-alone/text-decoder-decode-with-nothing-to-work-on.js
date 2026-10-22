const subject = new TextDecoder();
const first = new ArrayBuffer(0);
const result = subject.decode(first, null);
console.log(typeof result, result.length, result);
