const subject = new Uint8Array([1, 2, 3]);
const result = subject.toLocaleString(1.5, "text");
console.log(typeof result);
