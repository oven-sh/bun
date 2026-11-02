// The lookups are typed: `a` and `b` are strings, so the key is looked up by its parts and never becomes a string.
// What they are handed comes out of a helper, and the helper is handed `texts[i] + texts[j]`. Either read may be past the end, and undefined + undefined is NaN, so the helper's
// parameter may hold a number as far as the compiler knows. A method call on a number finds whatever somebody has put on Number.prototype, and this program stores under a key nobody
// knows through a value nobody knows. So what the helper answers is not known, and neither is what the lookups are handed. A test at their entrance would prove it.
// With `("" + text).split("")` in the helper, or with `holder` alone as the target of the store, both lines are met.
// CALLS+ getOfThree operationAOTMapGetByKeyParts
// CALLS+ hasOfTwo operationAOTHasByKeyParts
type Table = Map<string, number>;
export function getOfThree(table: Table, a: string, b: string): number | undefined { return table.get(a + ":" + b); }
export function hasOfTwo(table: Table, a: string, b: string): boolean { return table.has(a + b); }
function flat(text: string): string { return text.split("").join(""); }
function storeUnder(target: any, key: any, value: unknown): void { target[key] = value; }

const texts = ["", "a", "b", ":", "ab", "a:b", "é", "Ж"];
const size = texts.length;
const table: Table = new Map();
for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) if ((i + j * 5) % 3 === 0) { table.set(flat(texts[i] + texts[j]), i * size + j); table.set(flat(texts[i] + ":" + texts[j]), -i * size - j); }
const holder: Record<string, unknown> = {};
storeUnder((globalThis as any)[JSON.parse('"somewhere"')] ?? holder, JSON.parse('"kept"'), 1);
let found = 0, sum = 0;
for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
  const a = flat(texts[i] + texts[0]), b = flat(texts[0] + texts[j]);
  if (hasOfTwo(table, a, b)) found++;
  sum += getOfThree(table, a, b) ?? 0;
}
console.log(found, sum, Object.keys(holder).join());
