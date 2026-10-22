const subject = new Blob([]);
const result = subject.bytes();
const settled = await result;
console.log(settled instanceof Uint8Array, settled.length);
