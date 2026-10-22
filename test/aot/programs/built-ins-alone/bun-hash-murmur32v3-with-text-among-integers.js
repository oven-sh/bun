const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.murmur32v3(first, "text");
console.log(typeof result, result + 1);
