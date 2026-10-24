// Proxies over records, instances, arrays, functions and parsed data are read, stored to and called by typed code. One row differs from plain Bun: `number[]` is an array and a Proxy over an array is none, so the variable that is written so throws a TypeError.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Item = { id: number; n: number; tag?: string };
class Box { v = 1; get(): number { return this.v } }
function read(x: Item): number { return x.n }
function write(x: Item, v: number): number { x.n = v; return x.n }
row("a Proxy over a record, read by typed code", () => { let gets = 0; const p = new Proxy({ id: 1, n: 5 } as Item, { get(t, k, r) { gets++; return Reflect.get(t, k, r) } }); return read(p) + " " + gets });
row("a Proxy over a record, stored to by typed code", () => { let sets = 0; const t: Item = { id: 1, n: 5 }; const p = new Proxy(t, { set(o, k, v, r) { sets++; return Reflect.set(o, k, v, r) } }); return write(p, 9) + " " + sets + " " + t.n });
row("a Proxy over plain data held to the type", () => { let gets = 0; const p: Item = hide(new Proxy(parse('{"id":1,"n":5}'), { get(t, k, r) { gets++; return Reflect.get(t, k, r) } })); return read(p) + " " + (gets > 0) });
row("a Proxy over an instance: a method", () => { const p = new Proxy(new Box(), {}); return p.get() + " " + (p instanceof Box) });
row("a Proxy that answers otherwise", () => { const p = new Proxy({ id: 1, n: 5 } as Item, { get(t, k) { return k === "n" ? 42 : Reflect.get(t, k) } }); return read(p) });
row("a Proxy over an array, iterated and indexed by typed code", () => { const p: number[] = new Proxy([1, 2, 3], {}); let s = 0; for (const x of p) s += x; return s + " " + p[1] + " " + p.length + " " + Array.isArray(p) + " " + p.map(x => x * 2).join() });
row("a Proxy over a function, called by typed code", () => { const f: (a: number) => number = new Proxy((a: number) => a + 1, { apply(t, s, a) { return Reflect.apply(t, s, a) * 10 } }); return f(1) });
row("a revoked Proxy", () => { const { proxy, revoke } = Proxy.revocable({ id: 1, n: 5 } as Item, {}); revoke(); return read(proxy) });
row("Reflect.get | set | has | ownKeys on a record", () => { const t: Item = { id: 1, n: 5 }; Reflect.set(t, "n", 6); return Reflect.get(t, "n") + " " + Reflect.has(t, "tag") + " " + Reflect.ownKeys(t).join() + " " + Reflect.deleteProperty(t, "tag") });
