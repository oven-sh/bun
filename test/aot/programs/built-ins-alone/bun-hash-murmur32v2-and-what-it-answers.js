const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.murmur32v2(first, 2.5);
console.log(typeof result, result + 1);
