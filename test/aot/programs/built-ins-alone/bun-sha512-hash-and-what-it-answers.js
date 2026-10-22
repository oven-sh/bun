const first = new ArrayBuffer(8, { maxByteLength: 16 });
const result = Bun.SHA512.hash(first);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
