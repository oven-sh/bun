const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.cityHash32(first);
console.log(typeof result, result + 1);
