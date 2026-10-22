const first = new ArrayBuffer(8, { maxByteLength: 16 });
const second = new DataView(new ArrayBuffer(16));
const result = Bun.MD5.hash(first, second);
console.log(result === second, second instanceof DataView, second.byteLength, second.byteOffset);
