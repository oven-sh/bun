const first = new Uint8Array(0);
const result = Bun.JSONL.parseChunk(first, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, 1 / result.read, typeof result.done, result.done);
console.log(result.error === null);
