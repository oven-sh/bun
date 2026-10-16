// Negative zero, NaN, infinities, numbers beyond int32 and 2 ** 53, and fractions in fields of type number.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Cell = { i: number; f: number; o?: number };
class Count { n = 0; add(v: number): number { this.n += v; return this.n } }
row("-0 in a field", () => { const c: Cell = { i: 0, f: 0.5 }; c.i = -0; return Object.is(c.i, -0) + " " + Object.is(hide(c).i, -0) + " " + 1 / c.i });
row("NaN, Infinity", () => { const c: Cell = { i: 1, f: 1 }; c.i = NaN; c.f = -Infinity; return c.i + " " + c.f + " " + JSON.stringify(c) });
row("beyond int32 and back", () => { const c: Cell = { i: 1, f: 1 }; c.i = 2147483647; c.i += 1; const a = c.i; c.i = 4294967296 * 1024; const b = c.i; c.i = 3; return a + " " + b + " " + c.i });
row("beyond 2 ** 53", () => { const c = new Count(); c.add(9007199254740992); c.add(1); c.add(1); return c.n });
row("a fraction where ints were", () => { const c = new Count(); for (let k = 0; k < 100; ++k) c.add(1); c.add(0.5); return c.n });
row("many objects, each with a wide number", () => { const l: Cell[] = []; for (let k = 0; k < 2000; ++k) l.push({ i: k * 4294967296, f: k / 3 }); let s = 0; for (const c of l) s += c.i / 4294967296; return s });
row("a wide number through any and back", () => { const c: Cell = { i: 1, f: 1 }; hide(c).i = 1e300; return c.i + " " + typeof hide(c).i });
row("an optional number: undefined, then a number, then deleted", () => { const c: Cell = { i: 1, f: 1 }; const a = c.o; c.o = 5; const b = c.o; delete c.o; return a + " " + b + " " + c.o + " " + ("o" in c) });
