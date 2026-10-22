const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
const view = new Uint8Array(buffer);
console.log(buffer.byteLength, view.length, view.byteLength);
buffer.resize(8);
console.log(buffer.byteLength, view.length, view.byteLength);
