// Loops read fields of the elements of a value of type any, under an index: lists of every storage, lists with holes, strings, typed arrays, array-likes, proxies, arguments, what throws.
function total(rows: any, n: number): unknown { let sum = 0; for (let i = 0; i < n; i++) sum += rows[i].price * rows[i].qty; return sum; }
function names(rows: any, n: number): unknown { let out = ""; for (let i = 0; i < n; i++) out += rows[i].name + ","; return out; }
function counts(rows: any, n: number): unknown { let k = 0; for (let i = 0; i < n; i++) if (rows[i].on) k += rows[i].tags.length; return k; }
function calls(rows: any, n: number): unknown { let out = ""; for (let i = 0; i < n; i++) out += rows[i].toString() + "|"; return out; }
function nested(rows: any, n: number): unknown { let sum = 0; for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) sum += rows[i].cells[j].v; return sum; }
function stores(rows: any, n: number): unknown { for (let i = 0; i < n; i++) { rows[i].price += 1; if (i === 1) rows[2] = { price: -5, qty: 1, name: "late", on: 1, tags: [], cells: [{ v: 1 }, { v: 2 }] }; } return rows[0].price + rows[2].price; }
function shrinks(rows: any, n: number): unknown { let sum = 0; for (let i = 0; i < n; i++) { sum += rows[i].price; if (i === 1 && Array.isArray(rows)) rows.length = 2; } return sum; }
const row = (i: number): any => ({ price: i + 0.5, qty: i, name: "n" + i, on: i & 1, tags: ["a", "b"].slice(i & 1), cells: [{ v: i }, { v: i * 2 }], toString() { return "row" + i; } });
const list = (n: number): any[] => Array.from({ length: n }, (_, i) => row(i));
function sent(..._rows: any[]): any { return arguments; }
const makers: [string, () => any][] = [
  ["array", () => list(4)],
  ["parsed", () => JSON.parse('[{"price":1.5,"qty":2,"name":"a","on":0,"tags":[1],"cells":[{"v":1},{"v":2}]},{"price":2,"qty":1,"name":"b","on":1,"tags":[],"cells":[{"v":3},{"v":4}]},{"price":0,"qty":1,"name":"c","on":true,"tags":[2],"cells":[{"v":0.5},{"v":4}]}]')],
  ["holes", () => { const l = list(3); delete l[1]; return l; }],
  ["sparse", () => { const l = list(3); l[5000000] = row(9); return l; }],
  ["frozen", () => Object.freeze(list(3))],
  ["like", () => ({ 0: row(0), 1: row(1), 2: row(2), length: 3 })],
  ["getters", () => { const l = list(3); Object.defineProperty(l, 1, { get: () => row(7), configurable: true }); return l; }],
  ["proxy", () => new Proxy(list(3), { get: (t: any, k) => k === "1" ? row(8) : t[k] })],
  ["arguments", () => sent(row(0), row(1), row(2))],
  ["derived", () => { class Rows extends Array {} return Rows.from(list(3)); }],
  ["string", () => "abc"],
  ["numbers", () => [1, 2, 3]],
  ["doubles", () => [1.5, 2.5, 3.5]],
  ["view", () => new Float64Array([1, 2, 3])],
  ["bytes", () => new Uint8Array(3)],
  ["map", () => new Map([[0, row(0)]])],
  ["null", () => null],
  ["undefined", () => undefined],
  ["number", () => 5],
  ["above", () => Object.setPrototypeOf([row(0)], Object.assign(Object.create(Array.prototype), { 1: row(5), 2: row(6) }))],
];
for (let round = 0; round < 2; round++) {
  for (const [name, make] of makers) {
    const line: string[] = [];
    for (const run of [total, names, counts, calls, nested, stores, shrinks]) {
      try { line.push(String(run(make(), 3))); } catch (e) { line.push((e as Error).name); }
    }
    console.log(name, line.join(" ; "));
  }
}
