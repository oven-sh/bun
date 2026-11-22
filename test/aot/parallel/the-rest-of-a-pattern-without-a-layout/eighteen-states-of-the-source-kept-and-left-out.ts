const given = JSON.parse('{"turns":3,"half":0.5,"keys":{"age":"age","run":"run","note":"note","one":"1","late":"late","active":"active"}}');
const K = given.keys, mark = Symbol("m"), log: string[] = [];
type Row = { id: number; name: string; tags: number[]; age: number; ratio: number; active: boolean; run: () => number; note?: string };
function born(i: number): Row { return { id: i, name: "n" + i, tags: [i], age: 20 + i, ratio: i * given.half, active: i % 2 === 0, run: () => i * 2 }; }
const states: Record<string, (r: any) => void> = {
  plain: r => {}, filled: r => { r[K.note] = "x"; }, deleted: r => { delete r[K.age]; }, "deleted and back": r => { delete r[K.age]; r[K.age] = 5; }, "moved out": r => { r[K.age] = "text"; },
  "minus zero and NaN": r => { r.ratio = -0; r.age = 0 / 0; }, called: r => { r.run(); }, replaced: r => { r[K.run] = 7; }, grown: r => { r[K.late] = 1; }, "grown, deleted and back": r => { r[K.late] = 1; delete r[K.age]; r[K.age] = 5; },
  accessor: r => Object.defineProperty(r, K.age, { get() { log.push("age"); return 1; }, enumerable: true, configurable: true }),
  "accessor that changes the row": r => Object.defineProperty(r, K.age, { get() { log.push("cut"); delete r[K.active]; r[K.late] = 1; return 2; }, enumerable: true, configurable: true }),
  hidden: r => Object.defineProperty(r, K.age, { enumerable: false }), "read only": r => Object.defineProperty(r, K.age, { writable: false, configurable: false }),
  symbol: r => { r[mark] = 1; }, index: r => { r[K.one] = "one"; r[0] = "zero"; }, frozen: r => Object.freeze(r), sealed: r => Object.seal(r) };
function shown(o: any): string { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k)!; return String(k) + "=" + ("get" in d ? "getter" : typeof d.value === "function" ? "f" + d.value() : Object.is(d.value, -0) ? "-0" : String(d.value)) + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : ""); }).join(",") + (Object.isExtensible(o) ? "+" : "-") + (Object.getPrototypeOf(o) === Object.prototype ? "o" : "?"); }
function keeps(row: Row) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const { id, tags, ...rest } = row; return rest; }
function leaves(row: Row) { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; const { age, run, ...rest } = row; return rest; }
function summed(rest: any, turns: number): number { let s = 0; for (let i = 0; i < turns; i++) s += rest.age + rest.ratio; return s; }
const lines: string[] = [];
for (let round = 0; round < 2; round++) for (const name of Object.keys(states)) for (const [way, take] of [["keeps", keeps], ["leaves", leaves]] as const) {
  const row: any = born(3); states[name]!(row); const before = shown(row), rest: any = take(row), again: any = take(row), read = String(summed(again, given.turns));
  rest.id = "put"; delete rest.name; rest.ratio = "t";
  lines.push([name, way, shown(rest), shown(again), shown(row) === before, rest.run === row.run, read, shown({ ...again }), shown(take(again as Row))].join(" ; ")); }
console.log("SAID " + lines.join(" | ") + " | " + log.join());
export {};
