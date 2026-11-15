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
let text = "";
let seed = 7;
for (let i = 0; i < 400; i++) { seed = (seed * 3877 + 29573) % 139968; text += "acgt"[seed & 3]; }
for (const length of [0, 1, 2, 3, 4, 5, 7, 8, 9, 12, 15, 16, 17, 18, 24, 31, 32, 33, 48, 49, 64, 100, 399, 400, 401]) {
  const map = new Map<string, any>();
  tally(text, length, map);
  tally(text, length, map);
  let sum = 0, longest = "";
  for (const [key, value] of map) { sum += value * (key.length + 1); if (value > (map.get(longest) || 0)) longest = key; }
  console.log(length, map.size, sum, longest.length, map.get(text.slice(3, 3 + length)));
}
