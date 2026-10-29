// `table.get(a + "|" + b)`: the key is looked up by its parts. The parts of a key that was made before, of one that never was, numbers, empty parts, parts of two bytes a character, long parts.
const table = new Map<string, number>();
const words = new Set<string>();
const parts = ["alpha", "", "b", "été", "中文", "x".repeat(300), "7", "-0"];
const numbers = [0, -1, 7, 2147483647, -2147483648];

let stored = 0;
for (const a of parts) {
  for (const b of parts) {
    if ((a.length + b.length) % 2) continue;
    const key = a + "|" + b;
    table.set(key, ++stored);
    words.add(key);
  }
}
for (const a of parts) for (const n of numbers) if (n % 2) table.set(a + ":" + n, ++stored);
table.set("7", -7);
words.add("77");

const found: unknown[] = [];
for (let round = 0; round < 3; round++) {
  for (const a of parts) {
    for (const b of parts) {
      found.push(table.get(a + "|" + b) ?? "-", words.has(a + "|" + b) ? 1 : 0, table.has(b + "|" + a) ? 1 : 0);
    }
    for (const n of numbers) found.push(table.get(a + ":" + n) ?? "-");
    found.push(table.get(a + "") ?? "-", words.has(a + a) ? 1 : 0);
  }
}
console.log(found.join(" "));
table.delete("alpha|b");
words.delete("alpha|b");
console.log(table.get("alpha" + "|" + parts[2]), words.has(parts[0] + "|" + parts[2]), table.get(parts[0] + "|" + parts[2]));
table.clear();
console.log(table.get(parts[0] + "|" + parts[0]), table.has(parts[2] + "|" + parts[2]), words.has(parts[2] + "|" + parts[2]));
