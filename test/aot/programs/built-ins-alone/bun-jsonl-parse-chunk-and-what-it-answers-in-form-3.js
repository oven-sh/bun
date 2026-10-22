const result = Bun.JSONL.parseChunk(1.5, 2.5, 3.5);
console.log(typeof result, Object.keys(result).join(), Array.isArray(result.values), result.values.length);
console.log(typeof result.values[0], result.values[0] + 1, typeof result.read, result.read + 1);
console.log(typeof result.done, result.done, result.error === null);
