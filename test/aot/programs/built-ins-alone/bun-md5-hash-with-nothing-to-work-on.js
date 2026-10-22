const first = new ArrayBuffer(0);
const second = new DataView(new ArrayBuffer(16));
const result = Bun.MD5.hash(first, second);
console.log(result === second, second instanceof DataView, second.byteLength, second.byteOffset);
