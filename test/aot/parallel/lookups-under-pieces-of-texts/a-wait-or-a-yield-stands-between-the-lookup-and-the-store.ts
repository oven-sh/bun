function show(map: Map<any, any>): string {
  const parts: string[] = [];
  for (const [key, value] of map) parts.push(String(key) + "=" + String(value));
  return map.size + ": " + parts.join(" ");
}
async function slowly(text: string, map: Map<string, any>): Promise<void> {
  for (let i = 0; i + 2 <= text.length; i++) {
    const key = text.substring(i, i + 2);
    const held = map.get(key) || 0;
    await null;
    map.set(key, held + 1);
  }
}
function* bySteps(text: string, map: Map<string, any>): Generator<string> {
  for (let i = 0; i + 2 <= text.length; i++) {
    const key = text.substring(i, i + 2);
    const held = map.get(key) || 0;
    yield key;
    map.set(key, held + 1);
  }
}
const map = new Map<string, any>();
const both = [slowly("ababab", map), slowly("bababa", map)];
map.delete("ab");
await Promise.all(both);
console.log(show(map));
for (const key of bySteps("abcabc", map)) { if (key === "bc") map.clear(); if (key === "ca") for (let n = 0; n < 50; n++) map.set("n" + n, n); }
console.log(map.size, map.get("ab"), map.get("bc"), map.get("ca"), map.get("n49"));
