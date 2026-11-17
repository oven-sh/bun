// Elements of views read at a key that may be undefined: the value of the rare arm meets the element.
let table = new Int32Array(8).map((_, i) => i * i - 9), names = new Uint16Array(8).map((_, i) => i * 1000), halves = new Float64Array(8).map((_, i) => i / 2);
(table as any)["undefined"] = 5;
const keys: (number | undefined)[] = [0, 3, undefined, 7, 8, -1, undefined, 2];
function at(view: Int32Array, key: number | undefined): unknown { return view[key as number]; }
function sum(view: Int32Array, list: (number | undefined)[]): number { let s = 0; for (const k of list) { const v = view[k as number]; if (v === 7) s += 100; s += v === undefined ? 1000 : (v as number) * 2; } return s; }
function same(list: (number | undefined)[], text: string): number { let s = 0; for (let i = 0; i < list.length; i++) { const id = table[list[i] as number]; if (names[id as number] !== text.length * 1000) s++; if ((id as any) == null) s += 50; } return s; }
function half(list: (number | undefined)[]): string { let t = ""; for (const k of list) { const h = halves[k as number]; t += h + (h! > 1 ? "!" : "") + (h! | 0) + ","; } return t; }
for (let round = 0; round < 3; round++) {
  for (const key of keys) console.log(String(key), at(table, key), at(table, key) === undefined, typeof at(table, key), JSON.stringify([at(table, key)]));
  console.log(sum(table, [0, 3, 7, 8, -1, 2]), sum(table, [4, undefined, 4].slice(0, 1)), same(keys, "abc"), half(keys), half([1, 2, 3]));
  table = new Int32Array(table.length + round).map((_, i) => i + round); names = new Uint16Array(4 + round).fill(3000);
}
(table as any)["undefined"] = 0.5;
console.log(sum(table, keys), same(keys, "abcd"), keys.map(k => at(table, k)).join());
export {};
