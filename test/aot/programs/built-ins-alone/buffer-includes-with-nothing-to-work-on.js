const subject = Buffer.alloc(0);
const first = new Uint8Array(0);
const result = subject.includes(first, 2.5, 3.5, 4.5);
console.log(typeof result, result);
