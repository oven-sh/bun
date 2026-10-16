// The order of keys, symbols, index names, enumeration, copies and `toString` of records and instances.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string; sub?: string };
class Point { x = 1; y = 2 }
row("the order of keys: optional fields stored out of the declared order", () => { const t: Item = { id: 1, n: 1 }; t.sub = "s"; t.tag = "t"; return Object.keys(t).join() + " " + JSON.stringify(t) });
row("a literal written out of the declared order", () => { const t: Item = { n: 1, id: 2 }; return Object.keys(t).join() });
row("delete an optional field and store it again", () => { const t: Item = { id: 1, tag: "t", n: 1 }; delete t.tag; t.tag = "u"; return Object.keys(t).join() });
row("an optional field that holds undefined", () => { const t: Item = { id: 1, n: 1, tag: undefined }; return Object.keys(t).join() + " " + ("tag" in t) + " " + JSON.stringify(t) + " " + Object.hasOwn(t, "sub") });
row("names that are numbers, through any", () => { const t: Item = { id: 1, n: 1 }; const a = hide(t); a[2] = "two"; a[0] = "zero"; a.z = 1; return Object.keys(t).join() + " " + a[0] });
row("a symbol, through any", () => { const t: Item = { id: 1, n: 1 }; const s = Symbol("s"); hide(t)[s] = 5; return hide(t)[s] + " " + Object.getOwnPropertySymbols(t).length + " " + Reflect.ownKeys(t).length });
row("for..in, entries, spread, assign", () => { const t: Item = { id: 1, n: 2, sub: "s" }; const k: string[] = []; for (const n in t) k.push(n); return k.join() + " " + Object.entries(t).join("|") + " " + JSON.stringify({ ...t }) + " " + JSON.stringify(Object.assign({}, t)) });
row("what it says it is", () => { const t: Item = { id: 1, n: 1 }; return Object.prototype.toString.call(t) + " " + (t.constructor === Object) + " " + (Object.getPrototypeOf(t) === Object.prototype) + " " + String(t) + " " + typeof t });
row("an instance says what it is", () => { const p = new Point(); return p.constructor.name + " " + Object.keys(p).join() + " " + JSON.stringify(p) + " " + (Object.getPrototypeOf(p) === Point.prototype) + " " + Object.prototype.toString.call(p) });
row("structuredClone", () => { const t: Item = { id: 1, n: 2 }; const c = hide(globalThis).structuredClone ? hide(globalThis).structuredClone(t) : { ...t }; return JSON.stringify(c) + " " + (c !== t) });
