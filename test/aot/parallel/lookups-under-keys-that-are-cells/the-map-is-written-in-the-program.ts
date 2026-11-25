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
const map = new Map<string, any>([["ab", 10], ["bc", 20], ["zz", 30], ["ca", 40]]);
function read(text: string, map: Map<string, any>): string {
  let out = "";
  for (let i = 0; i + 2 <= text.length; i++) out += String(map.get(text.substring(i, i + 2))) + ",";
  return out;
}
console.log(read("abcabzz", map));
tally("abcabzz", 2, map);
console.log(show(map));
console.log(read("abcabzz", map));
