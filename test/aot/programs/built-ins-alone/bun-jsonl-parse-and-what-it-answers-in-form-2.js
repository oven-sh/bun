const result = Bun.JSONL.parse(1.5);
console.log(Array.isArray(result), result.length, typeof result[0], result[0] + 1);
