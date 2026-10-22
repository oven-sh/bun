const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.hash.cityHash64(first, 2.5);
console.log(typeof result, result + 1n);
