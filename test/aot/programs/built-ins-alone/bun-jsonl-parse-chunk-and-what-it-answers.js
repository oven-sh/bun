const first = new Uint8Array([1, 2, 3]);
const result = Bun.JSONL.parseChunk(first, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, typeof result.done, result.done);
console.log(result.error instanceof SyntaxError, result.error.message);
