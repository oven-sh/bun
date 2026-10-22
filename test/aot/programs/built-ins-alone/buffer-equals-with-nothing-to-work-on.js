const subject = Buffer.alloc(0);
const first = new DataView(new ArrayBuffer(16));
const result = subject.equals(first);
console.log(typeof result, result);
