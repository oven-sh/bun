// Tables with narrow and wide columns, grown, with entries deleted, made by a literal and by a loop.
function sums(map: Map<unknown, unknown>) { let keys = 0, values = 0, pairs = 0; for (const key of map.keys()) keys += String(key).length; for (const value of map.values()) values += String(value).length; for (const [key, value] of map.entries()) pairs += String(key).length + String(value).length; return keys + ":" + values + ":" + pairs + ":" + map.size; }
const texts = new Map<unknown, unknown>(); for (let i = 0; i < 3000; i++) texts.set("k" + i, "v" + i);
const numbers = new Map<unknown, unknown>(); for (let i = 0; i < 3000; i++) numbers.set(i, i * 1.5);
const mixed = new Map<unknown, unknown>(); for (let i = 0; i < 3000; i++) mixed.set(i % 3 ? i : "s" + i, i % 2 ? { i } : i);
const holes = new Map<unknown, unknown>(texts); for (let i = 0; i < 3000; i += 2) holes.delete("k" + i);
console.log(sums(texts), sums(numbers), sums(mixed), sums(holes), sums(new Map([[1, 2]])), sums(new Map()));
let total = 0; for (let turn = 0; turn < 300; turn++) { for (const value of numbers.values()) total += value as number; }
console.log(total);
const set = new Set<unknown>(); for (let i = 0; i < 3000; i++) set.add(i % 5 ? i : "t" + i);
let members = 0; for (const value of set.values()) members += String(value).length; for (const key of set.keys()) members += String(key).length; for (const [a, b] of set.entries()) members += a === b ? 1 : 1000;
console.log(members);
