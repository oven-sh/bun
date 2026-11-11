// The same key looked up in the same table more than once, with and without what changes the table between.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : v instanceof Map ? "{" + [...v].join(" ") + "}" : String(v)) + " "; log += "\n"; }
function nested(m: Map<number, Map<number, number>>, n: number): number { let s = 0; for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) s += m.get(i)!.get(k)!; return s; }
function written(m: Map<number, Map<number, number>>): number { let s = 0; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) s += m.get(i)!.get(k)!; return s; }
function twice(m: Map<string, number>, key: string): string { return m.get(key) + " " + m.get(key); }
function hasThenGet(m: Map<string, number>, key: string): number { return m.has(key) ? m.get(key)! + m.get(key)! : -1; }
function setBetween(m: Map<any, number>, key: any): string { const a = m.get(key); m.set(key, (a ?? 0) + 1); const b = m.get(key); m.delete(key); const c = m.get(key), d = m.has(key); m.set(key, 7); return [a, b, c, d, m.get(key), m.has(key)].join(" "); }
function setOther(m: Map<string, number>, other: Map<string, number>, key: string): string { const a = m.get(key); other.set(key, 100); const b = m.get(key); other.delete(key); return a + " " + b + " " + m.get(key); }
function clearBetween(m: Map<string, number>, key: string): string { const a = m.get(key); m.clear(); return a + " " + m.get(key) + " " + m.has(key); }
function callBetween(m: Map<string, number>, key: string, run: () => void): string { const a = m.get(key); run(); return a + " " + m.get(key); }
function members(s: Set<any>, key: any): string { const a = s.has(key); s.add(key); const b = s.has(key); s.delete(key); return a + " " + b + " " + s.has(key) + " " + s.has(key); }
function fresh(n: number): string { const m = new Map<number, number>(); let t = ""; for (let i = 0; i < n; i++) { t += m.get(i & 1) + " "; m.set(i & 1, (m.get(i & 1) ?? 0) + i); t += m.get(i & 1) + " "; } return t; }
function freshEscapes(sink: Map<any, any>[]): string { const m = new Map<string, number>([["a", 1]]); const a = m.get("a"); sink.push(m); change(sink); return a + " " + m.get("a"); }
function change(sink: Map<any, any>[]): void { for (const m of sink) m.set("a", 50); }
function joined(m: Map<string, number>, a: string, b: string): string { return m.get(a + b) + " " + m.get(a + b) + " " + m.has(a + b); }
function branches(m: Map<string, number>, key: string, flag: boolean): string { let t = m.get(key) + " "; if (flag) m.set(key, 9); t += m.get(key); return t; }
function loops(m: Map<string, number>, keys: string[]): number { let s = 0; for (const key of keys) { s += m.get(key) ?? 0; s += m.get(key) ?? 0; if (m.has(key)) m.set(key, m.get(key)! + 1); s += (m.get(key) ?? 0) * 100; } return s; }
function iterated(m: Map<string, number>): string { let t = ""; for (const [key, value] of m) { t += key + value + m.get(key) + " "; if (value < 3) m.set(key + "x", value + 1); t += m.get(key) + (m.has(key + "x") ? "y" : "n") + " "; } return t; }
function each(m: Map<string, number>): string { let t = ""; m.forEach((value, key) => { t += m.get(key); m.delete(key); t += m.get(key) + (m.get(key) === undefined ? "gone" : "there") + value + " "; }); return t; }
class Memo { table = new Map<number, number>(); get(n: number): number { const found = this.table.get(n); if (found !== undefined) return found; const made = n < 2 ? n : this.get(n - 1) + this.get(n - 2); this.table.set(n, made); return this.table.get(n)! + this.table.get(n)! - made; } }
class Mine extends Map<string, number> { asked = 0; get(key: string): number | undefined { this.asked++; return super.get(key); } }
function* steps(m: Map<string, number>, key: string): Generator<any> { yield m.get(key); yield m.get(key); m.set(key, 3); yield m.get(key); yield m.has(key); }
async function waits(m: Map<string, number>, key: string): Promise<string> { const a = m.get(key); queueMicrotask(() => m.set(key, 77)); await 0; const b = m.get(key); return a + " " + b + " " + m.get(key); }
function thrown(m: Map<string, number>, key: string, f: () => void): string { let t = m.get(key) + " "; try { f(); t += m.get(key); } catch { t += "caught " + m.get(key); } finally { t += " " + m.get(key); } return t; }
function weak(m: WeakMap<object, number>, key: object): string { const a = m.get(key); m.set(key, 4); const b = m.get(key); m.delete(key); return a + " " + b + " " + m.get(key) + " " + m.has(key); }
const table = (n: number): Map<number, Map<number, number>> => new Map(Array.from({ length: n }, (_, i) => [i, new Map(Array.from({ length: n }, (_, k) => [k, i * 10 + k] as [number, number]))] as [number, Map<number, number>]));
const letters = (): Map<string, number> => new Map([["a", 1], ["b", 2], ["ab", 3], ["é", 4]]);
for (let round = 0; round < 4; round++) {
  for (const n of [0, 1, 4, 8]) show(nested(table(n), n));
  show(written(table(5)), written(new Map(Array.from({ length: 4 }, (_, i) => [i, new Map([[0, 0.5], [1, -0], [2, NaN], [3, 1e10]])] as [number, Map<number, number>]))));
  try { show(nested(table(3), 4)); } catch (error: any) { show(error.constructor.name); }
  for (const key of ["a", "b", "ab", "é", "none", "a" + round]) { const m = letters(); show(twice(m, key), hasThenGet(m, key), setBetween(m, key), setOther(m, letters(), key), setOther(m, m, key), callBetween(m, key, () => m.set(key, 12)), callBetween(m, key, () => {}), branches(m, key, round > 1), clearBetween(m, key)); }
  for (const key of [0, -0, NaN, 1.5, 4294967296, 5n, "5", Symbol.iterator, null, undefined, true, {}, []] as any[]) { const m = new Map<any, number>([[0, 10], [NaN, 11], [1.5, 12], [5n, 13], ["5", 14], [null, 15], [undefined, 16], [true, 17]]); log += setBetween(m, key) + " " + members(new Set([0, NaN, 5n, "5", null]), key) + "\n"; }
  show(fresh(6), freshEscapes([]), joined(letters(), "a", "b"), joined(letters(), "x", "y"), loops(letters(), ["a", "b", "a", "z", "ab"]), iterated(letters()), each(letters()));
  const memo = new Memo(); show(memo.get(30), memo.table.size); const mine = new Mine([["a", 1]]); show(twice(mine, "a"), mine.asked, hasThenGet(mine, "a"), mine.asked);
  show([...steps(letters(), "b")], thrown(letters(), "a", () => {}), thrown(letters(), "a", () => { throw 1; }), weak(new WeakMap(), {}));
  const m = letters(); show(thrown(m, "a", () => { m.set("a", 8); throw 1; }), thrown(m, "a", () => { m.delete("a"); }));
  const g = steps(m, "b"); show(g.next().value); m.set("b", 40); show(g.next().value, g.next().value, g.next().value);
}
waits(letters(), "a").then(t => { show(t); console.log(log.length, log); });
