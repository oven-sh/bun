const subject = new Uint8Array([1, 2, 3]);
const result = subject.toLocaleString(1.5, 2.5);
console.log(typeof result);
