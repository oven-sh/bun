const first = new Uint8Array([1, 2, 3]);
const result = Bun.JSONL.parseChunk(first, "text", "text");
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.read, result.read + 1, 1 / result.read, typeof result.done, result.done);
console.log(result.error instanceof SyntaxError, result.error.message);
