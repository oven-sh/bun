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
const odd = { valueOf() { if (armed) { armed = false; for (let n = 0; n < 200; n++) map.delete("f" + n); } return 5; } };
for (let n = 0; n < 200; n++) map.set("f" + n, n);
tally("xabyxabyab", 2, map);
console.log(show(map).length, map.get("ab"), map.get("xa"));
for (let round = 0; round < 3; round++) {
  map.set("ab", odd);
  armed = round === 1;
  tally("xabyxabyab", 2, map);
  console.log(map.size, map.get("ab"), map.get("xa"), map.get("by"), map.get("q2"), map.get("zz"), map.get("k299"), map.get("f199"));
}
const small = new Map<string, any>();
for (const [key, value] of map) if (key.length === 2) small.set(key, value);
console.log(show(small));
