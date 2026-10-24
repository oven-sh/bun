// Instances of a class with typed fields get accessors, lose fields, change prototypes, stand behind a Proxy, are frozen and sealed, and receive values of other types; arrays are subclassed, faked and shortened while they are read; numbers in fields overflow, are -0 and NaN.
function show(label: string, f: () => unknown) {
    try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name); }
}
class P { x = 1; y = 2.5; s = "s"; m() { return this.x + this.y; } }
function sum(p: P) { return p.x + p.y; }
function callM(p: P) { return p.m(); }
show("defineProperty accessor", () => { const p = new P(); let n = 0; Object.defineProperty(p, "x", { get() { return ++n * 100; }, configurable: true }); return [sum(p), sum(p), callM(p)].join(); });
show("delete field", () => { const p = new P(); delete (p as any).x; return [sum(p), "x" in p, Object.keys(p).join("+")].join(); });
show("delete then proto", () => { const p = new P(); delete (p as any).x; (P.prototype as any).x = 50; const r = sum(p); delete (P.prototype as any).x; return r; });
show("proxy", () => { const log: string[] = []; const p = new Proxy(new P(), { get(t, k, r) { log.push(String(k)); return Reflect.get(t, k, r); } }); return [sum(p), callM(p), log.join("+")].join(); });
show("setPrototypeOf", () => { const p = new P(); Object.setPrototypeOf(p, { m() { return "other"; } }); return [callM(p), p instanceof P].join(); });
show("method replaced on instance", () => { const p = new P(); (p as any).m = () => "own"; return callM(p); });
show("method replaced on prototype", () => { const old = P.prototype.m; P.prototype.m = function () { return -1; }; const r = callM(new P()); P.prototype.m = old; return r + "," + callM(new P()); });
show("wrong types by any", () => { const p = new P(); (p as any).x = "str"; (p as any).y = { valueOf() { return 4; } }; return sum(p); });
show("wrong types by assign", () => { const p = Object.assign(new P(), { x: "a", y: null } as any) as P; return sum(p); });
show("json", () => { const o = JSON.parse('{"a":"str","b":{"c":[1,"2"]}}') as { a: number; b: { c: number[] } }; return [o.a + 1, o.b.c[0] + o.b.c[1], o.b.c.map(x => x * 2).join("/")].join(); });
show("frozen instance", () => { "use strict"; const p = Object.freeze(new P()); const set = (p: P) => { p.x = 9; return p.x; }; return set(p); });
show("sealed add", () => { const p = Object.seal(new P()); (p as any).z = 1; return Object.keys(p).join("+"); });
show("preventExtensions", () => { const p = Object.preventExtensions(new P()); try { (p as any).z = 1; } catch (e) { return "threw " + (e as Error).constructor.name; } return Object.keys(p).join("+"); });
class MyArr extends Array<number> { total() { let t = 0; for (const x of this) t += x; return t; } }
function first(a: number[]) { return a[0] + a.length; }
show("array subclass", () => { const a = new MyArr(); a.push(1, 2, 3); const m = a.map(x => x * 2); return [first(a), a.total(), m instanceof MyArr, (m as MyArr).total(), Array.isArray(a)].join(); });
show("array like as array", () => { const fake = { 0: 5, length: 1 } as unknown as number[]; return first(fake); });
show("array index accessor", () => { const a: number[] = [1, 2, 3]; Object.defineProperty(a, 0, { get() { return 42; } }); return first(a); });
show("length shrink", () => { const a: number[] = [1, 2, 3]; const f = (a: number[]) => { let t = 0; for (let i = 0, n = a.length; i < n; i++) { if (i == 0) a.length = 1; t += a[i]; } return t; }; return f(a); });
show("int overflow field", () => { class C { n = 2147483647; inc() { this.n++; return this.n; } } const c = new C(); return [c.inc(), c.inc(), (c.n * c.n)].join(); });
show("negative zero field", () => { class C { n = 0; } const c = new C(); c.n = -0; const d = new C(); d.n = c.n * 1; return [Object.is(c.n, -0), Object.is(d.n, -0), 1 / d.n].join(); });
show("nan field", () => { class C { n = 1; } const c = new C(); c.n = NaN; return [c.n === c.n, c.n | 0].join(); });
show("generic lie", () => { function f<T>(x: T): T { return 42 as any; } const s: string = f("text"); return typeof s + "," + (s as any + 1) + "," + s.length; });
show("overload lie", () => { function g(x: string): string; function g(x: number): number; function g(x: any): any { return typeof x === "string" ? 5 : "five"; } const a: string = g("a"); const b: number = g(1); return [typeof a, typeof b, b + 1, a.length].join(); });
show("fewer parameters", () => { const f: (a: number, b: number) => number = function (a: number) { return a + arguments.length; }; return f(1, 2); });
show("void returning value", () => { const f: () => void = () => 5; const r = f(); return String(r); });
show("spread of instance", () => { const c = { ...new P() }; return [Object.keys(c).join("+"), "m" in c].join(); });
