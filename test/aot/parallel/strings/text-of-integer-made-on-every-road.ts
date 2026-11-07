// The text of an integer made on every road.
const base = process.argv.length > 99 ? 7 : 0;
function joined(id: number): string { return "" + id; }
function templated(id: number): string { return `${id}`; }
function converted(id: number): string { return String(id); }
function byMethod(id: number): string { return id.toString(); }
function built(id: number): string {
  let text = "";
  for (let rest = id, scale = 1000000000; scale >= 1; scale = Math.floor(scale / 10)) {
    const digit = Math.floor(rest / scale) % 10;
    if (text.length || digit || scale === 1) text += digit;
  }
  return text;
}
function inTwoParts(id: number): string { return "" + Math.floor(id / 1000) + ("" + (1000 + (id % 1000))).slice(1); }

const roads = [joined, templated, converted, byMethod, built, inTwoParts];
const ids: number[] = [1000, 1023, 1024, 1025, 4096, 65535, 65536, 99999, 100000, 1234567, 16777216, 2147483646, 2147483647];
const table = new Map<string, number>();
const record: Record<string, number> = {};
const wrong: string[] = [];
let digest = 0;
for (let round = 0; round < 4; round++) {
  for (const id0 of ids) {
    const id = id0 + base;
    const expected = roads[round % roads.length](id);
    for (let r = 0; r < roads.length; r++) {
      const text = roads[r](id);
      if (text !== expected || text.length !== expected.length) wrong.push(`text ${r} ${id}`);
      if (Number(text) !== id) wrong.push(`number ${r} ${id}`);
      table.set(text, (table.get(text) ?? 0) + 1);
      record[text] = (record[text] ?? 0) + 1;
      digest = (digest * 31 + text.charCodeAt(text.length - 1) + text.length) | 0;
    }
  }
}
for (let n = 0; n < 70000; n++) {
  const key = joined(n * 13 + 1024 + base);
  if (!table.has(key)) table.set(key, n);
  if (n % 977 === 0 && templated(n * 13 + 1024 + base) !== key) wrong.push(`late ${n}`);
}
for (const id0 of ids) {
  const id = id0 + base;
  if (record[id] !== 4 * roads.length) wrong.push(`record ${id} ${record[id]}`);
  if (record[built(id)] !== record[joined(id)]) wrong.push(`record by text ${id}`);
}
console.log(table.size, Object.keys(record).length, digest, wrong.length, wrong.slice(0, 8).join("|"));
