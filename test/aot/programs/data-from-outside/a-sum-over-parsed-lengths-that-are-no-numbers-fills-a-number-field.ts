interface Item { lines: string[] }
interface Result { kept: Item[]; dropped: number }
function trim(items: Item[], limit: number): Result {
  const kept: Item[] = [];
  let used = 0;
  let dropped = 0;
  for (const item of items) {
    if (limit - used <= 0) { dropped += item.lines.length; continue; }
    kept.push(item);
    used += item.lines.length;
  }
  return { kept, dropped };
}
const r = trim(JSON.parse(process.argv.length > 5 ? "[]" : "[{\"lines\":[\"a\",\"b\"]},{\"lines\":{\"length\":\"x\"}}]"), 2);
console.log(r.kept.length, r.dropped, typeof r.dropped);
