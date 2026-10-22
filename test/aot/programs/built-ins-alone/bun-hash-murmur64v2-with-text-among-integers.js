const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.murmur64v2(first, "text");
console.log(typeof result, result + 1n);
