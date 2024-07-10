const buffer = new ArrayBuffer(1024, {
  maxByteLength: 2048,
});

console.log(buffer.byteLength); // 1024
buffer.resize(2048);
console.log(buffer.byteLength); // 2048
TextDecoder;

const buf = new SharedArrayBuffer(1024);
buf.grow(2048);
