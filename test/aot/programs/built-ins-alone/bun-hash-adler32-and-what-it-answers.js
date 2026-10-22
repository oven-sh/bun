const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.adler32(first);
console.log(typeof result, result + 1);
