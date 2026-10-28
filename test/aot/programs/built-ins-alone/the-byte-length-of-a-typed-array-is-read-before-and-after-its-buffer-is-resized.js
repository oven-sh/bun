const view = new Int8Array(new ArrayBuffer(1024, { maxByteLength: 1024 }));
console.log(view.byteLength, view.length);
view.buffer.resize(8);
console.log(view.byteLength, view.length);
