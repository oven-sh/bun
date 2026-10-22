const buffer = new ArrayBuffer(4, { maxByteLength: 8 });
const view = new Uint8Array(buffer);
console.log(view.length);
buffer.resize(8);
console.log(view.length, view[7]);
buffer.resize(2);
console.log(view.length, view[3] === undefined);
