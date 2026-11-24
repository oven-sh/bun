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
function joined(n: number): string { let s = ""; for (let i = 0; i < n; i++) s = s + String.fromCharCode(97 + i % 5) + "x"; return s; }
const map = new Map<string, any>();
tally(joined(20) + joined(9), 3, map);
console.log(show(map));
const whole = joined(40);
tally(whole.substring(5, 31), 4, map);
console.log(show(map));
tally(whole.slice(7).slice(2, 20), 2, map);
console.log(show(map));
