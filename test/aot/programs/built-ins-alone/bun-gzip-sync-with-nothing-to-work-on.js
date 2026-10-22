const first = new ArrayBuffer(0);
const result = Bun.gzipSync(first);
console.log(result instanceof Uint8Array, result.length, typeof result[0], result[0] + 1);
console.log(typeof result[1], result[1] + 1);
