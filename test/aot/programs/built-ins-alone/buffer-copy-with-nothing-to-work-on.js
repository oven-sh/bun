const subject = Buffer.alloc(0);
const first = new DataView(new ArrayBuffer(16));
const result = subject.copy(first, 2.5, "x", 4.5);
console.log(typeof result, result + 1, 1 / result);
