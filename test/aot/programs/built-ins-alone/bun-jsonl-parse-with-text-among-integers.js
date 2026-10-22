const result = Bun.JSONL.parse("text");
console.log(Array.isArray(result), result.length);
