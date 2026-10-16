// Typed objects in Map, Set, WeakMap and WeakRef, and objects that are used as dictionaries.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number };
class Node1 { v = 1 }
row("typed objects as keys", () => { const a: Item = { id: 1, n: 1 }, b: Item = { id: 1, n: 1 }; const m = new Map<Item, number>([[a, 1], [b, 2]]); const s = new Set<Item>([a, b, a]); const w = new WeakMap<Item, number>([[a, 5]]); return m.get(a) + " " + m.get(b) + " " + s.size + " " + w.get(a) + " " + w.has(b) });
row("plain data as a key, then held to a type", () => { const r = parse('{"id":1,"n":1}'); const m = new Map<unknown, number>([[r, 1]]); const w = new WeakSet<object>([r]); const t: Item = r; return m.get(t) + " " + w.has(t) + " " + m.has(r) });
row("WeakRef", () => { const t = new Node1(); const w = new WeakRef(t); return w.deref()!.v + " " + (w.deref() === t) });
row("-0, NaN as keys", () => { const m = new Map<number, string>([[NaN, "nan"], [0, "zero"]]); return m.get(NaN) + " " + m.get(-0) + " " + [...new Set([0, -0, NaN, NaN])].length });
row("the order of a Map with deletes", () => { const m = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]); m.delete("b"); m.set("b", 4); m.set("a", 5); return [...m].join("|") });
row("a Map changed while it is iterated", () => { const m = new Map<number, number>([[1, 1]]); const out: number[] = []; for (const [k] of m) { out.push(k); if (k < 4) m.set(k + 1, 0) } return out.join() });
row("an object as a dictionary: numbers first", () => { const d: Record<string, number> = {}; d.b = 1; d["2"] = 2; d.a = 3; d["1"] = 4; return Object.keys(d).join() });
row("__proto__ as a key of a dictionary", () => { const d: Record<string, unknown> = {}; d["__proto__"] = 5; const e = parse('{"__proto__":5}'); return Object.keys(d).length + " " + Object.keys(e).length + " " + e.__proto__ });
row("constructor, toString, hasOwnProperty as keys", () => { const d: Record<string, number> = {}; const before = typeof d["constructor"] + " " + ("toString" in d); d["constructor"] = 1; d["hasOwnProperty"] = 2; return before + " " + Object.keys(d).join() });
row("a dictionary without a prototype", () => { const d: Record<string, number> = Object.create(null); d.a = 1; return ("toString" in d) + " " + Object.keys(d).join() + " " + JSON.stringify(d) });
