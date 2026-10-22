const subject = new Uint8Array([1, 2, 3]);
const result = subject.toLocaleString("an", 2.5);
console.log(typeof result);
