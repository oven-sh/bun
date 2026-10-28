const view = new Int8Array(new ArrayBuffer(1024, { maxByteLength: 1024 }));
view[1000] = 7;
console.log(view.byteLength, view[1000]);
view.buffer.resize(8);
console.log(view.byteLength, view[1000], 1000 in view);
view[1000] = 9;
view.buffer.resize(1024);
console.log(view.byteLength, view[1000]);
