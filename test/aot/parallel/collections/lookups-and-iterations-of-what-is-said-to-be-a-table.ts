// Loops over lookups and iterations of receivers that are maps, sets and others.
const all: boolean = process.argv[2] === "all"; let lines = 0, hash = 0, log = "";
function say(line: string): void { lines++; for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0; if (all) console.log(line.slice(0, 260)); else if (lines % 47 === 0) console.log(lines, hash); }
function show(x: any): string { return Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "symbol" ? "symbol" : Array.isArray(x) ? "[" + x.map(show).join() + "]" : typeof x === "object" && x ? x.constructor?.name + "{}" : String(x); }
class Own extends Map<any, any> { get(k: any): any { log += "g"; return super.get(k); } has(k: any): boolean { log += "h"; return k === 3 || super.has(k); } values(): any { log += "v"; return super.keys(); } keys(): any { log += "k"; return [7, 8].values(); } entries(): any { log += "e"; return super.entries(); } }
class Heir extends Map<any, any> { extra = 1; }
class OwnSet extends Set<any> { has(k: any): boolean { log += "h"; return !super.has(k); } add(k: any): this { log += "a"; return super.add(k); } values(): any { log += "v"; return ["s", 5].values(); } }
class OwnList extends Array<any> { values(): any { log += "lv"; return ["o", 1].values(); } keys(): any { log += "lk"; return super.entries(); } }
class HeirList extends Array<any> { extra = 1; }
class Steps { at = 0; next(): any { log += "n"; return { done: this.at > 2, value: this.at++ }; } return(): any { log += "r"; return {}; } [Symbol.iterator](): any { return this; } }
const keyLists: any[] = [[0, 1, 2, 3, 2, 1, 0], [], ["a", "b", "1", "", "long key of many letters"], [0.5, NaN, -0, 0, 1e300, 2 ** 31, -1], [null, undefined, true, 1n, "x"], [1, "1", 1.5, NaN, "a", null], JSON.parse("[3,2,1,0,5,9]"), JSON.parse('["a","b","zz"]')];
const seed: any[] = [[0, "zero"], [1, 11], [2, 2.5], [3, null], ["a", "A"], ["1", "one"], ["", "empty"], [0.5, "half"], [NaN, "nan"], [null, "null"], [undefined, "undef"], [true, 1], [1n, "big"]];
const makers: Record<string, () => any> = {
  map: () => new Map(seed), none: () => new Map(), ints: () => new Map([[0, 1], [1, 2], [2, 3], [3, 4], [5, 6]]), texts: () => new Map([["a", 1], ["b", 2], ["1", 3]]), many: () => new Map(Array.from({ length: 70 }, (_, i) => [i, "v" + i] as any)), holes: () => { const m = new Map(seed); m.delete(1); m.delete("a"); m.delete(0); return m; }, cleared: () => { const m = new Map(seed); m.clear(); m.set(2, "again"); return m; },
  set: () => new Set([0, 1, 2, "a", "1", NaN, 0.5, null]), emptySet: () => new Set(), bigSet: () => new Set(Array.from({ length: 40 }, (_, i) => i * 3)),
  own: () => new Own(seed), heir: () => new Heir(seed), ownSet: () => new OwnSet([1, 2, "a"]), withGet: () => Object.assign(new Map(seed), { get: (k: any) => "own" + show(k), values: () => ["w", 1].values() }), withHas: () => Object.assign(new Set([1, 2]), { has: (k: any) => k === 0, keys: () => new Steps() }),
  withProto: () => Object.setPrototypeOf(new Map(seed), { get: (k: any) => "proto", has: () => true, values: () => new Steps(), keys: () => ["p"].values(), entries: () => [["q", 1]].values(), set() { return this; }, get size() { return 99; } }),
  weak: () => new WeakMap(), plain: () => ({ get: (k: any) => "plain" + show(k), has: (k: any) => k === 1, set(k: any, v: any) { log += "s"; return this; }, add(k: any) { log += "a"; return this; }, delete: () => true, size: 4, values: () => [1, 2, "three"], keys: () => new Steps(), entries: () => [[1, 2]], [Symbol.iterator]: () => new Steps() }),
  ints5: () => [5, 1, 2, 9, 4], doubles: () => [0.5, 1.5, NaN, -0], none0: () => [], texts2: () => JSON.parse('["p","q"]'), parsed: () => JSON.parse("[1,2,2.5,null]"), sparse: () => { const l: any[] = [1, 2]; l[40] = 3; return l; }, long: () => Array.from({ length: 90 }, (_, i) => i), ownList: () => new OwnList("a", "b", "c"), heirList: () => new HeirList(3, 4, 5), listWith: () => Object.assign([1, 2], { values: () => ["w"].values(), keys: () => new Steps() }), listProto: () => Object.setPrototypeOf([1, 2], { values: () => ["y"].values(), keys: () => [8].values(), __proto__: Array.prototype }), frozenList: () => Object.freeze([1, "f"]), getterList: () => Object.defineProperty([1, 2, 3], 1, { get() { log += "G"; return "got"; }, configurable: true }), proxyList: () => new Proxy([1, 2], { get(t: any, k: any, r: any) { log += typeof k === "symbol" ? "y" : k[0]; return Reflect.get(t, k, r); } }), args: () => (function () { return arguments; } as any)(1, 2),
  list: () => [5, 6, , "a", 8.5], pairs: () => [[1, "x"], ["a", 2]], view: () => new Int32Array([4, 5, 6]), floats: () => new Float64Array([0.5, NaN, -0]), search: () => new URLSearchParams("a=1&b=2&a=3"), nothing: () => undefined, nil: () => null, text: () => "ab1", number: () => 5, proxy: () => new Proxy(new Map(seed), {}), steps: () => new Steps(), generator: () => (function* () { try { yield 1; yield "two"; yield [3, 4]; } finally { log += "f"; } })(), frozen: () => Object.freeze(new Map(seed)), inherited: () => Object.create(new Map(seed)),
};
function get(m: Map<any, any>, keys: any[]): any { let s = ""; for (let i = 0; i < keys.length; i++) s += show(m.get(keys[i])) + ","; return s; }
function getOf(m: Map<any, any>, keys: any[]): any { let s = ""; for (const k of keys) s += show(m.get(k)) + ","; return s; }
function getOr(m: Map<any, any>, keys: any[]): any { let s = 0; for (let i = 0; i < keys.length; i++) s += +(m.get(keys[i]) ?? 100); return s; }
function getIf(m: Map<any, any>, keys: any[]): any { let s = ""; for (const k of keys) { const v = m.get(k); if (v !== undefined) s += show(v); else s += "-"; } return s; }
function has(m: Map<any, any>, keys: any[]): any { let n = 0; for (let i = 0; i < keys.length; i++) if (m.has(keys[i])) n += i + 1; return n; }
function hasSet(m: Set<any>, keys: any[]): any { let n = 0; for (const k of keys) if (m.has(k)) n++; else n += 10; return n; }
function late(m: Map<any, any>, keys: any[]): any { let s = ""; for (let i = 0; i < keys.length; i++) { if (i < 2) continue; s += show(m.get(keys[i])); } return s; }
function armed(m: Map<any, any>, keys: any[]): any { let s = ""; for (let i = 0; i < keys.length; i++) { if (keys[i] === 2) s += show(m.get(keys[i])); } return s; }
function count(m: Map<any, any>, keys: any[]): any { for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1); return m.size + show([...m.values()]); }
function put(m: Map<any, any>, keys: any[]): any { for (let i = 0; i < keys.length; i++) m.set(keys[i], i); return m.size; }
function add(m: Set<any>, keys: any[]): any { for (let i = 0; i < keys.length; i++) m.add(keys[i]); return m.size; }
function drop(m: Map<any, any>, keys: any[]): any { let n = 0; for (const k of keys) if (m.delete(k)) n++; return n + " " + m.size; }
function size(m: Map<any, any>, keys: any[]): any { let n = 0; for (let i = 0; i < keys.length; i++) { n = n * 3 + m.size; m.delete(keys[i]); } return n; }
function replaced(m: Map<any, any>, keys: any[]): any { let s = ""; for (let i = 0; i < keys.length; i++) { s += show(m.get(keys[i])); if (i === 2) (m as any).get = () => "R"; } return s; }
function changed(m: Map<any, any>, keys: any[]): any { let s = ""; for (let i = 0; i < keys.length; i++) { s += show(m.get(keys[i])); if (i === 1) Object.setPrototypeOf(m, { get: () => "P" }); } return s; }
function swapped(m: Map<any, any>, keys: any[]): any { let s = "", t: any = m; for (let i = 0; i < keys.length; i++) { s += show(t.get(keys[i])); if (i === 2) t = new Map([[keys[i + 1], "T"]]); } return s; }
function twoTables(m: Map<any, any>, keys: any[]): any { const seen = new Set<any>(); let n = 0; for (const k of keys) { if (seen.has(k)) { n += 100; continue; } seen.add(k); if (m.has(k)) n++; } return n; }
function nested(m: Map<any, any>, keys: any[]): any { let n = 0; for (const a of keys) for (const b of keys) if (m.has(a) && m.get(b) !== undefined) n++; return n; }
function whileLoop(m: Map<any, any>, keys: any[]): any { let i = 0, s = ""; while (i < keys.length && m.get(keys[i]) !== null) { s += show(m.get(keys[i])); i++; } return s + i; }
function caught(m: Map<any, any>, keys: any[]): any { let s = ""; for (const k of keys) { try { s += show(m.get(k)); } catch (e: any) { s += e.constructor.name; } } return s; }
function each(m: Map<any, any>, keys: any[]): any { let s = ""; keys.forEach((k: any) => { s += show(m.get(k)); }); return s; }
function values(m: Map<any, any>): any { let s = ""; for (const v of m.values()) s += show(v) + ","; return s; }
function keys(m: Map<any, any>): any { let s = ""; for (const v of m.keys()) s += show(v) + ","; return s; }
function entries(m: Map<any, any>): any { let s = ""; for (const [k, v] of m.entries()) s += show(k) + "=" + show(v) + ","; return s; }
function pairs(m: Map<any, any>): any { let s = ""; for (const [k, v] of m) s += show(k) + "=" + show(v) + ","; return s; }
function whole(m: Set<any>): any { let s = ""; for (const v of m) s += show(v) + ","; return s; }
function setValues(m: Set<any>): any { let s = ""; for (const v of m.values()) s += show(v) + ","; return s; }
function sumValues(m: Map<any, any>): any { let n = 0; for (const v of m.values()) n += +v || 1; return n; }
function leftValues(m: Map<any, any>): any { let n = 0; for (const v of m.values()) { n++; if (n === 2) break; } return n; }
function returned(m: Map<any, any>): any { for (const v of m.keys()) { if (v === 2 || v === "b") return "found " + show(v); } return "no"; }
function thrown(m: Map<any, any>): any { for (const v of m.values()) { if (v === 2.5 || v === 1) throw new RangeError("at " + show(v)); } return "no"; }
function deleting(m: Map<any, any>): any { let s = ""; for (const v of m.keys()) { s += show(v); m.delete(v); } return s + m.size; }
function deletingNext(m: Map<any, any>): any { let s = ""; for (const v of m.keys()) { s += show(v); m.delete(2); m.delete("1"); } return s + m.size; }
function adding(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (n++ < 3) m.set("new" + n, n); } return s + m.size; }
function clearing(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (n++ === 1) { m.clear(); m.set("c", "after"); } } return s + m.size; }
function moving(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.keys()) { s += show(v); if (n++ < 4) { const x = m.get(v); m.delete(v); m.set(v, x); } } return s; }
function twice(m: Map<any, any>): any { let s = ""; for (const a of m.values()) for (const b of m.keys()) s += show(a)[0] + show(b)[0]; return s.length + s.slice(0, 60); }
function heldIterator(m: Map<any, any>): any { const it = m.values(); let s = ""; for (const v of it) { s += show(v); if (s.length > 5) break; } for (const v of it) s += "|" + show(v); return s; }
function inTry(m: Map<any, any>): any { let s = ""; try { for (const v of m.values()) { s += show(v); if (v === null) throw "T"; } } catch (e: any) { s += "!" + (e.constructor?.name ?? e); } finally { s += "."; } return s; }
function byName(m: Map<any, any>): any { const n: any = log.length > 1e6 ? "keys" : "values"; let s = ""; for (const v of (m as any)[n]()) s += show(v); return s; }
function firstKeys(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 3; i++) { s += show(m.keys().next().value); if (i === 1) m.delete(0); } return s; }
function firstValues(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 3; i++) s += show(m.values().next().value) + show((m.entries().next().value as any)?.[0]); return s; }
function evicting(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 5; i++) { m.set("e" + i, i); if (m.size > 6) { const old = m.keys().next().value; s += show(old); m.delete(old); } } return s + m.size; }
function evictingAll(m: Map<any, any>): any { let s = ""; while (m.size) { const old = m.keys().next().value; s += show(old); if (!m.delete(old)) break; if (s.length > 200) break; } return s; }
function firstOfPattern(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 2; i++) { const [a] = m.keys(); const [b, c] = m.values(); s += show(a) + show(b) + show(c); m.delete(a); } return s; }
function restOfPattern(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 2; i++) { const [a, ...rest] = m.values(); s += show(a) + rest.length; } return s; }
function doneOf(m: Map<any, any>): any { let s = ""; for (let i = 0; i < 2; i++) { const it = m.values(); let r = it.next(); while (!r.done) { s += show(r.value); r = it.next(); } } return s; }
function indexedKeys(m: Map<any, any>): any { let s = ""; for (const i of m.keys()) s += show((m as any)[i]); return s; }
function indexedHolder(m: Map<any, any>): any { const o: any = { m }; let s = ""; for (const i of o.m.keys()) s += show(o.m[i]); return s; }
function growing(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (n++ < 3) (m as any).push?.("g" + n); } return s; }
function growingKeys(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.keys()) { s += show(v); if (n++ < 3) { if (Array.isArray(m)) (m as any)[m.length + 2] = n; else m.set("k" + n, n); } } return s; }
function shrinking(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (n++ === 1 && Array.isArray(m)) (m as any).length = 1; } return s; }
function shifting(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); (m as any).shift?.(); if (n++ > 60) break; } return s; }
function changedKind(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (Array.isArray(m) && n++ === 0) { (m as any)[1] = "text"; (m as any)[2] = 0.25; delete (m as any)[3]; } } return s; }
function laidGetter(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (Array.isArray(m) && n++ === 0 && m.length > 2) Object.defineProperty(m, 2, { get() { log += "D"; return "late"; }, configurable: true }); } return s; }
function laidProto(m: Map<any, any>): any { let s = "", n = 0; for (const v of m.values()) { s += show(v); if (n++ === 0) Object.setPrototypeOf(m, null); } return s; }
function twoLoops(m: Map<any, any>): any { let s = ""; for (const v of m.values()) { s += show(v); if (s.length > 4) break; } for (const k of m.keys()) s += show(k); for (const v of m.values()) s += show(v); return s; }
function inFinally(m: Map<any, any>): any { let s = ""; for (const k of m.keys()) { try { if (k === 1) continue; s += show(k); if (k === 3) break; } finally { s += ";"; } } return s; }
function labels(m: Map<any, any>): any { let s = ""; outer: for (const a of m.values()) for (const b of m.keys()) { if (b === 1) continue outer; if (a === null) break outer; s += show(a)[0] + show(b); if (s.length > 150) return s; } return s; }
function optional(m: Map<any, any>): any { let s = ""; for (const v of m?.values() ?? []) s += show(v); return s; }
function indexes(m: Map<any, any>): any { let n = 0; for (const i of m.keys()) n = n * 2 + (i as any); return n; }
function objects(m: Map<any, any>): any { let s = ""; for (const { length } of m.values()) s += length; return s; }
function patternValues(m: Map<any, any>): any { let s = ""; for (const [a, b] of m.values()) s += show(a) + show(b); return s; }
function awaited(m: Map<any, any>): any { let s = ""; for (const v of m.values()) { if (typeof v === "string") for (let i = 0; i < v.length; i++) s += v.charCodeAt(i); } return s; }
const lookups: Record<string, (m: any, keys: any[]) => any> = { get, getOf, getOr, getIf, has, hasSet, late, armed, count, put, add, drop, size, replaced, changed, swapped, twoTables, nested, whileLoop, caught, each }, iterations: Record<string, (m: any) => any> = { values, keys, entries, pairs, whole, setValues, sumValues, leftValues, returned, thrown, deleting, deletingNext, adding, clearing, moving, twice, heldIterator, inTry, byName, firstKeys, firstValues, evicting, evictingAll, firstOfPattern, restOfPattern, doneOf, indexedKeys, indexedHolder, growing, growingKeys, shrinking, shifting, changedKind, laidGetter, laidProto, twoLoops, inFinally, labels, optional, indexes, objects, patternValues, awaited };
function run(name: string, f: () => any): void { log = ""; let r: any; try { r = show(f()); } catch (e: any) { const said = String(e?.message ?? e); r = "! " + e?.constructor?.name + " " + (/is not iterable|is not a function \(near/.test(said) ? "no iterator" : said); } say(name + " " + r + " " + log); }
for (let turn = 0; turn < 2; turn++) {
  for (const maker of Object.keys(makers)) for (const name of Object.keys(lookups)) for (let k = 0; k < keyLists.length; k++) run([maker, name, k].join(" "), () => lookups[name]!(makers[maker]!(), keyLists[k].slice()));
  for (const maker of Object.keys(makers)) for (const name of Object.keys(iterations)) run(maker + " " + name, () => iterations[name]!(makers[maker]!()));
}
console.log("lines", lines, hash);
