const result = Bun.JSONL.parse("an");
console.log(Array.isArray(result), result.length);
