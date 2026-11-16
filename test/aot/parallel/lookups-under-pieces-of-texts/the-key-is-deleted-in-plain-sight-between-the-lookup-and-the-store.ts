function show(map: Map<any, any>): string {
  const parts: string[] = [];
  for (const [key, value] of map) parts.push(String(key) + "=" + String(value));
  return map.size + ": " + parts.join(" ");
}
function move(text: string, map: Map<string, any>): void {
  for (let i = 0; i + 2 <= text.length; i++) {
    const key = text.substring(i, i + 2);
    const held = map.get(key) || 0;
    map.delete(key);
    map.set(key, held + 1);
  }
}
function empty(text: string, map: Map<string, any>): void {
  for (let i = 0; i + 2 <= text.length; i++) {
    const key = text.substring(i, i + 2);
    const held = map.get(key) || 0;
    if (held === 2) map.clear();
    map.set(key, held + 1);
  }
}
const map = new Map<string, any>();
move("abcabcabd", map); console.log(show(map));
empty("abcabcabdababab", map); console.log(show(map));
