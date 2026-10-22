const first = new ArrayBuffer(0);
const result = Bun.zstdDecompressSync(first);
console.log(result instanceof Buffer, result.length);
