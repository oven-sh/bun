const held = Bun.JSONL.parseChunk("an", 2.5, 3.5);
function show(value) {
  if (Array.isArray(value)) return value.map(show).join();
  return typeof value === "object" || typeof value === "function" ? typeof value : `${typeof value} ${String(value)}`;
}
for (const [key, value] of Object.entries(held)) console.log(key, show(value));
