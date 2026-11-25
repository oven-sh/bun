function show(map: Map<any, any>): string {
  const parts: string[] = [];
  for (const [key, value] of map) parts.push(String(key) + "=" + String(value));
  return map.size + ": " + parts.join(" ");
}
function tally(text: string, length: number, map: Map<string, any>): void {
  const cut: string[] = [];
  for (let i = 0; i + length <= text.length; i++) cut.push(text.substring(i, i + length));
  const keys: string[] = JSON.parse(JSON.stringify(cut));
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    map.set(key, (map.get(key) || 0) + 1);
  }
}
const map = new Map<any, any>();
map.set(1.5, "a"); map.set(12, "b"); map.set(null, "c"); map.set(undefined, "d"); map.set(2 ** 40, "e"); map.set(Symbol.iterator, "f"); map.set(12n, "g"); map.set(map, "h");
tally("12121.51.5nullnull", 2, map);
tally("12121.51.5nullnull", 3, map);
tally("12121.51.5nullnull", 4, map);
let out = "";
for (const [key, value] of map) out += typeof key + ":" + (typeof key === "string" ? key : "") + "=" + String(value === map ? "map" : value) + " ";
console.log(map.size, out);
