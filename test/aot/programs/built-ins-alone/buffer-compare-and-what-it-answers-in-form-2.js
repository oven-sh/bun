const subject = Buffer.from("banana and more text, 24");
const first = new Uint8Array([1, 2, 3]);
const result = subject.compare(first, 2);
console.log(typeof result, result + 1);
