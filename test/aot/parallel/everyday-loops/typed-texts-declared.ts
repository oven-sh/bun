// Declared lists of texts and of records, pushed on both levels
interface Entry { key: string; count: number }
function entries(keys: readonly string[], start: number): Entry[] {
  const out: Entry[] = [];
  for (let i = 0; i < 2; i++) {
    for (let k = 0; k < 3; k++) {
      out.push({ key: keys[k], count: start + k });
    }
    out.push({ key: keys[i] + "*", count: out.length });
  }
  return out;
}
console.log(JSON.stringify(entries(["a", "b", "c"], 0)));
console.log(entries(["x", "y", "z"], 0.5).map(entry => entry.key + entry.count).join());
console.log(entries([], -1).length, entries(["é", "", "q"], 2147483647).map(({ count }) => count).join());
