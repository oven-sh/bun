// Maps, sets, errors, dates, regular expressions and promises that a cast gave members of their own are used through interfaces that extend the built-in type. An interface that extends Iterable takes a Set and an instance of a class of the program.
interface MultiMap<K, V> extends Map<K, V[]> { add(key: K, value: V): V[]; count: number }
interface Tagged extends Set<string> { tag: string }
interface Coded extends Error { code: string }
type WithStatus = Error & { status: number };
interface Cancelable<T> extends Promise<T> { cancel(): void; canceled: boolean }
interface Stamp extends Date { zone: string }
interface Named extends RegExp { title: string }
interface Lookup extends ReadonlyMap<string, number> { fallback: number }
interface Bag extends Iterable<number> { size: number }
function add<K, V>(this: MultiMap<K, V>, key: K, value: V) { this.count++; let values = this.get(key); if (values) values.push(value); else this.set(key, values = [value]); return values; }
function createMultiMap<K, V>(): MultiMap<K, V> { const map = new Map<K, V[]>() as MultiMap<K, V>; map.add = add; map.count = 0; return map; }
function entries(m: MultiMap<string, number>): number { let n = m.size + m.count; for (const [k, v] of m) n += k.length + v.length; m.forEach(v => { n += v.length; }); return n + [...m.keys()].length; }
function tagged(s: Tagged): string { let t = s.tag; for (const x of s) t += x; return t + s.size + s.has("a"); }
function coded(e: Coded): string { return e.code + e.message + (e instanceof Error) + e.name; }
function status(e: WithStatus): string { return e.status + e.message; }
function stamp(d: Stamp): string { return d.zone + d.getTime(); }
function named(r: Named): string { return r.title + r.test("abc") + r.source; }
function lookup(l: Lookup, k: string): number { return l.get(k) ?? l.fallback; }
function bag(b: Bag): number { let n = b.size; for (const x of b) n += x; return n; }
class OwnBag implements Bag { size = 2; *[Symbol.iterator]() { yield 1; yield 2; } }
async function cancelable(p: Cancelable<number>): Promise<number> { p.cancel(); return (await p) + (p.canceled ? 1 : 0); }
let n = 0, t = "";
const m = createMultiMap<string, number>();
for (let i = 0; i < 100; i++) {
  m.add("k" + (i % 3), i); n += entries(m);
  const s = new Set(["a", "b"]) as Tagged; s.tag = "t"; t = tagged(s);
  const e = new Error("m") as Coded; e.code = "E"; t += coded(e);
  const w = Object.assign(new TypeError("w"), { status: 4 }); t += status(w);
  const d = new Date(5) as Stamp; d.zone = "z"; t += stamp(d);
  const r = /b/ as Named; r.title = "r"; t += named(r);
  const l = new Map([["a", 1]]) as Map<string, number> & { fallback: number }; l.fallback = 9; n += lookup(l, "a") + lookup(l, "b");
  const b = new Set([1, 2]); n += bag(b) + bag(new OwnBag());
}
const p = Promise.resolve(3) as Cancelable<number>; p.canceled = false; p.cancel = function (this: Cancelable<number>) { this.canceled = true; };
console.log(n, t, await cancelable(p));
