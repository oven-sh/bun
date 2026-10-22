const subject = new TextDecoder();
const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = subject.decode(first, null);
console.log(typeof result, result.length, result);
