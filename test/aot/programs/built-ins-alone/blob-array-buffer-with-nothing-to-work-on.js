const subject = new Blob([]);
const result = subject.arrayBuffer();
const settled = await result;
console.log(settled instanceof ArrayBuffer, settled.byteLength);
