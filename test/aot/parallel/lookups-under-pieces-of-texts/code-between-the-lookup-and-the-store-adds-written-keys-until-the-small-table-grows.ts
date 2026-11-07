function show(map: Map<any, any>): string {
  const parts: string[] = [];
  for (const [key, value] of map) parts.push(String(key) + "=" + String(value));
  return map.size + ": " + parts.join(" ");
}
function tally(text: string, length: number, map: Map<string, any>): void {
  for (let i = 0; i + length <= text.length; i++) {
    const key = text.substring(i, i + length);
    map.set(key, (map.get(key) || 0) + 1);
  }
}
const map = new Map<string, any>();
let armed = false;
const odd = { valueOf() { if (armed) { armed = false; map.set("n1", 1); map.set("n2", 2); map.set("n3", 3); } return 5; } };
tally("abab", 2, map);
for (let round = 0; round < 3; round++) {
  map.set("ab", odd);
  armed = round === 1;
  tally("abab", 2, map);
  console.log(show(map));
}
