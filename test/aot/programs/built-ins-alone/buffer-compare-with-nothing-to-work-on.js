const subject = Buffer.alloc(0);
const first = new Uint8Array(0);
const result = subject.compare(first, 2);
console.log(typeof result, result + 1, 1 / result);
