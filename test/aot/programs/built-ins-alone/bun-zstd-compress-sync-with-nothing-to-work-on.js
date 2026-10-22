const first = new ArrayBuffer(0);
const result = Bun.zstdCompressSync(first);
console.log(result instanceof Buffer, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
