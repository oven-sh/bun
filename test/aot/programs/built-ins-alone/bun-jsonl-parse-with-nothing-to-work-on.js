const first = new Uint8Array(0);
const result = Bun.JSONL.parse(first);
console.log(Array.isArray(result), result.length);
