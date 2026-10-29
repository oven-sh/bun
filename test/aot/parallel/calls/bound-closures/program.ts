declare const console: any; declare function gc(): void;
const O: any = Object;
function say(n: string, f: () => unknown): void { let r: string; try { r = JSON.stringify(f()) ?? "undefined"; } catch (e: any) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
function describe(d: any): string { return d ? [typeof d.value === "function" ? "function" : d.value, typeof d.get, d.writable, d.enumerable, d.configurable].join() : "none"; }
function see(b: any): unknown { return [typeof b, b.name, b.length, Reflect.ownKeys(b).map(String).join(), "prototype" in b, O.getPrototypeOf(b) === Function.prototype, String(b).replace(/\s+/g, " "), Function.prototype.toString.call(b).replace(/\s+/g, " "), O.prototype.toString.call(b), describe(O.getOwnPropertyDescriptor(b, "name")), describe(O.getOwnPropertyDescriptor(b, "length")), O.isExtensible(b)]; }
class K0 { v = 1; m(x: number, y: number = 2): number { return this.v + x + y; } three(a: number, b: number, c: number): number { return this.v + a * 100 + b * 10 + c; } static st(x: number): number { return x * 2; } none(): number { return this.v; } }
const k0 = new K0();
say("seen", () => see(k0.m.bind(k0))); say("seen, one argument", () => see(k0.three.bind(k0, 1))); say("seen, three", () => see(k0.three.bind(k0, 1, 2, 3))); say("seen, no parameter", () => see(k0.none.bind(k0))); say("seen, static", () => see(K0.st.bind(K0)));
say("called", () => { const b: any = k0.m.bind(k0); return [b(1), b(1, 1), b(1, 1, 1), b.call({ v: 50 }, 1), b.apply({ v: 50 }, [1, 1]), Reflect.apply(b, null, [1])]; });
say("arguments", () => { const t: any = k0.three; return [k0.three.bind(k0)(1, 2, 3), k0.three.bind(k0, 1)(2, 3), k0.three.bind(k0, 1, 2)(3), k0.three.bind(k0, 1, 2, 3)(), (k0.three.bind(k0, 1, 2, 3) as any)(9), t.bind(k0, 1, 2, 3, 4)(), t.bind(k0, 1, 2, 3, 4).length, t.bind(k0, 1, 2, 3, 4, 5).name]; });
say("more than it takes", () => { const n: any = k0.none; return [n.bind(k0, 1)(), n.bind(k0, 1).length, n.bind(k0, 1, 2)(3)]; });
say("another each time", () => [k0.m.bind(k0) === k0.m.bind(k0), k0.m.bind(k0) == k0.m.bind(k0)]);
say("new", () => new (k0.m.bind(k0) as any)()); say("Reflect.construct", () => Reflect.construct(k0.m.bind(k0) as any, [])); say("extends", () => { class X extends (k0.m.bind(k0) as any) {} return typeof X; });
say("instanceof, an object", () => ({}) instanceof (k0.m.bind(k0) as any)); say("instanceof, a number", () => (1 as any) instanceof (k0.m.bind(k0) as any));
say("caller", () => (k0.m.bind(k0) as any).caller); say("arguments", () => (k0.m.bind(k0) as any).arguments); say("has caller", () => [O.hasOwn(k0.m.bind(k0), "caller"), O.hasOwn(k0.m.bind(k0), "arguments"), O.hasOwn(k0.m.bind(k0), "prototype")]);
say("properties", () => { const b: any = k0.m.bind(k0); b.extra = 1; const d = delete b.name; O.defineProperty(b, "length", { value: 9 }); b.prototype = { z: 1 }; return [b.extra, d, b.name, b.length, Reflect.ownKeys(b).join(), b(1), ({}) instanceof b]; });
say("name is read-only", () => { "use strict"; const b: any = k0.m.bind(k0); b.name = "x"; return b.name; });
say("bound again", () => { const b: any = k0.three.bind(k0, 1); const c = b.bind(null, 2); return [c.name, c.length, c(3), c.bind(null, 3)(), c.bind(null, 3).name]; });
say("no this", () => (k0.none as any).bind()()); say("null", () => (k0.none as any).bind(null)());
say("through call", () => see(Function.prototype.bind.call(k0.m, k0))); say("through apply", () => Function.prototype.bind.apply(k0.three, [k0, 1, 2] as any)(3)); say("by key", () => (k0.m as any)["bi" + "nd"](k0)(1));
// The function is not as it was made.
class K1 { v = 1; m(x: number): number { return this.v + x; } } O.defineProperty(K1.prototype.m, "name", { value: "renamed" });
say("name was defined", () => { const k = new K1(); return [k.m.bind(k).name, k.m.bind(k)(1)]; });
class K2 { v = 1; m(x: number): number { return this.v + x; } } O.defineProperty(K2.prototype.m, "length", { value: 7 });
say("length was defined", () => { const k = new K2(); return [k.m.bind(k).length, k.m.bind(k, 1).length, k.m.bind(k)(1)]; });
class K3 { v = 1; m(x: number): number { return this.v + x; } } (K3.prototype.m as any).bind = function () { return "mine"; };
say("a bind of its own", () => { const k = new K3(); return k.m.bind(k); });
class K4 { v = 1; m(x: number): number { return this.v + x; } } O.setPrototypeOf(K4.prototype.m, { bind() { return "inherited"; } });
say("another prototype", () => { const k = new K4(); return (k.m as any).bind(k); });
class K5 { v = 1; m(x: number): number { return this.v + x; } } (K5.prototype.m as any).extra = 1;
say("a property that does not matter", () => { const k = new K5(); return [k.m.bind(k).name, k.m.bind(k).length, k.m.bind(k)(1)]; });
class K6 { v = 1; m(x: number): number { return this.v + x; } } O.defineProperty(K6.prototype.m, "name", { value: 5 });
say("a name that is no string", () => { const k = new K6(); return k.m.bind(k).name; });
class K7 { v = 1; m(x: number): number { return this.v + x; } }
say("altered between two binds", () => { const k = new K7(); const a = k.m.bind(k).name; O.defineProperty(K7.prototype.m, "name", { value: "later" }); return [a, k.m.bind(k).name]; });
// It is not what was expected.
class B0 { v = 1; constructor() { this.m = this.m.bind(this); } m(x: number): number { return this.v + x; } }
class D0 extends B0 { constructor() { super(); this.m = this.m.bind(this); } }
say("bound in the constructor", () => { const b = new B0(); const f = b.m; return [f(1), f.name, O.keys(b).join(), b.m === b.m, b.m(2)]; });
say("bound in both constructors", () => { const d = new D0(); const f = d.m; return [f(1), f.name, f.length, d.m(2)]; });
class B1 { v = 1; m(x: number): number { return this.v + x; } } class D1 extends B1 { m(x: number): number { return this.v - x; } }
say("an heir's method", () => { const all: B1[] = [new B1(), new D1()]; return all.map(o => [o.m.bind(o)(1), o.m.bind(o).name]); });
// Other functions.
const lit = { w: 2, get(x: number): number { return this.w + x; } };
say("a literal's method", () => [see(lit.get.bind(lit)), lit.get.bind(lit)(1)]);
const arrow = (x: number, y: number): number => x * 10 + y;
say("an arrow", () => [see(arrow.bind(null)), arrow.bind(null)(1, 2), arrow.bind({}, 1)(2), arrow.bind(null, 1, 2)()]);
const adder = (c: number) => (x: number): number => c + x;
say("an arrow that captures", () => [adder(3).bind(null)(4), adder(3).bind(null, 4)(), adder(3).bind(null).name, adder(5).bind(null, 1).length]);
function plain(this: any, x: number): number { return (this ? this.v : 0) + x; }
say("a function that constructs", () => { const b: any = plain.bind({ v: 1 }); return [see(b), b(1), typeof new b(1), new b(1) instanceof plain, new b(1) instanceof b]; });
class A0 { v = 1; async later(x: number): Promise<number> { return this.v + x; } *gen(x: number): Generator<number> { yield this.v + x; } }
const a0 = new A0();
console.log("async: " + await a0.later.bind(a0)(1) + " " + a0.later.bind(a0).name + " " + O.prototype.toString.call(a0.later.bind(a0)) + " " + (O.getPrototypeOf(a0.later.bind(a0)) === O.getPrototypeOf(a0.later)));
say("a generator", () => [[...a0.gen.bind(a0)(1)], a0.gen.bind(a0).name, "prototype" in a0.gen.bind(a0)]);
say("a class", () => { const b: any = K0.bind(null); return [b.name, b.length, new b().v, new b() instanceof K0]; });
say("a native function", () => [Math.max.bind(Math, 3)(1), Math.max.bind(null).name]);
function rest(this: any, ...a: number[]): number { return a.length; }
class R0 { many(...a: number[]): number { return a.length; } args(): number { return arguments.length; } }
say("rest and arguments", () => { const r = new R0(); return [r.many.bind(r, 1)(2, 3), r.many.bind(r).length, (r.args as any).bind(r, 1, 2)(3), rest.bind(null, 1)(2)]; });
// Stack traces have no frame of it.
function names(e: any): string { return String(e.stack).split("\n").map((l: string) => /(t_[a-z]+)/.exec(l)).filter(Boolean).map((m: any) => m[1]).join(); }
class T0 { t_fails(x: number): number { if (x) throw new Error("x"); return 0; } }
function t_calls(f: (x: number) => number): number { return f(1) + 1; }
say("the stack", () => { const t = new T0(); try { return t_calls(t.t_fails.bind(t)); } catch (e) { return names(e); } });
// Its captures stay alive.
say("many", () => { const fs: Array<(x: number) => number> = []; for (let i = 0; i < 20000; i++) { const k = new K7(); k.v = i; fs.push(k.m.bind(k)); } if (typeof gc === "function") gc(); let s = 0; for (const f of fs) s += f(1); return s; });
// Async targets. An awaited value is printed when it has settled: the rows appear in the order in which they are started.
const AsyncFunction: any = Object.getPrototypeOf(async function () { });
class Y0 { v = 7; async later(x: number): Promise<number> { return this.v + x; } async two(a: number, b: number): Promise<number> { await null; return this.v + a * 10 + b; } async fails(): Promise<number> { throw new RangeError("from fails " + this.v); } }
say("async: what can be seen", () => { const a = new Y0(); const f: any = a.later.bind(a); return [typeof f, f.name, f.length, Object.getPrototypeOf(f) === AsyncFunction, Object.getPrototypeOf(f) === Function.prototype, Object.hasOwn(f, "prototype"), Object.prototype.toString.call(f), String(f).replace(/\s+/g, " "), f instanceof Function, Object.getOwnPropertyNames(f).sort()]; });
say("async: it yields a promise", () => { const a = new Y0(); const f = a.later.bind(a); const p = f(1); return [p instanceof Promise, Object.getPrototypeOf(p) === Promise.prototype, f !== a.later.bind(a)]; });
say("async: not a constructor", () => { const a = new Y0(); const f: any = a.later.bind(a); try { new f(); return "constructed"; } catch (e: any) { return e.constructor.name; } });
class Y1 { v = 1; later: (x: number) => Promise<number>; constructor() { this.later = this.run.bind(this); } async run(x: number): Promise<number> { return this.v + x; } }
class Y2 { v = 2; constructor() { (this as any).run = this.run.bind(this); } async run(x: number): Promise<number> { return this.v + x; } }
const asyncArrow = async (x: number): Promise<number> => x * 2;
async function settle(): Promise<void> {
    const a = new Y0(); a.v = 40;
    const show = async (n: string, f: () => Promise<unknown>): Promise<void> => { let r: string; try { r = JSON.stringify(await f()) ?? "undefined"; } catch (e: any) { r = "rejects " + e.constructor.name + ": " + e.message; } console.log(n + ": " + r); };
    await show("async: this", () => a.later.bind(a)(2));
    await show("async: another this", () => { const other = new Y0(); other.v = 100; return a.later.bind(other)(2); });
    await show("async: a bound argument", () => a.two.bind(a, 1)(2));
    await show("async: both bound, more given", () => (a.two as any).bind(a, 1, 2)(3, 4));
    await show("async: it rejects, it does not throw", async () => { const f = a.fails.bind(a); let threw = false; let p: Promise<number> | undefined; try { p = f(); } catch { threw = true; } return [threw, await p!.then(() => "fulfilled", (e: any) => e.message)]; });
    await show("async: as a callback", () => Promise.all([1, 2, 3].map(a.later.bind(a))));
    await show("async: bound in the constructor, another name", () => { const f = new Y1().later; return f(5); });
    await show("async: the idiom", () => { const o = new Y2(); const f = o.run; return Promise.all([f(5), o.run(6), Promise.resolve(Object.hasOwn(o, "run"))]); });
    await show("async: an arrow", () => (asyncArrow as any).bind(null, 4)());
    await show("async: bound twice", () => a.later.bind(a).bind({ v: 0 } as any)(1));
    await show("async: a property on the method first", () => { const m: any = Y0.prototype.later; m.marker = 1; const f: any = a.later.bind(a); const r = [f.marker, f.name]; delete m.marker; return Promise.resolve(r); });
    await show("async: its own bind", () => { const m: any = Y0.prototype.two; m.bind = function () { return async () => "mine"; }; const f: any = (a.two as any).bind(a); delete m.bind; return f(); });
    await show("async: many", async () => { const fs: Array<(x: number) => Promise<number>> = []; for (let i = 0; i < 5000; i++) { const k = new Y0(); k.v = i; fs.push(k.later.bind(k)); } if (typeof gc === "function") gc(); let t = 0; for (const f of fs) t += await f(1); return t; });
}
settle();
export {};
