// An object that is cast to a subtype later on is allocated as that subtype: own keys and their order, absent fields, the prototype, and early returns and throws stay unchanged.
declare const console: any;
const log: any[] = [];
interface B { a: number; b: string | undefined; o?: number }
interface C extends B { c: number }
interface D extends C { d: number }
interface E extends B { e: string }
function B(this: B, a: number) { this.a = a; this.b = undefined; }
function Other(this: B, a: number) { this.b = "other"; this.a = -a; }
const makers: { get(): new (a: number) => B } = { get: () => B as any };
const seen: any[] = [];
let hook: ((x: B) => void) | undefined;
function show(x: any) { return JSON.stringify(x) + " keys " + Object.keys(x).join() + " B " + (x instanceof (B as any)) + " c " + ("c" in x) + " d " + ("d" in x) + " e " + ("e" in x); }
function factory() {
    var M = makers.get();
    function base(a: number): B { const r = new M(a); hook?.(r); return r; }
    function asC(a: number): C { const r = base(a) as C; r.c = a + 1; return r; }
    function asD(a: number): D { const r = asC(a) as D; r.d = a + 2; return r; }
    function returnsEarly(a: number): B { const r = base(a); if (a & 1) return r; const c = r as C; c.c = 5; return c; }
    function throwsBefore(a: number): C { const r = base(a); seen.push(r); if (a < 0) throw new RangeError("before"); const c = r as C; c.c = 6; return c; }
    function twoCasts(a: number): string { const r = base(a); let out = ""; try { const c = r as C; c.c = 1; out += "C"; } catch (x: any) { out += "!" + x.constructor.name; } try { const e = r as E; e.e = "e"; out += "E"; } catch (x: any) { out += "!" + x.constructor.name; } return out + Object.keys(r).join(); }
    function inOneArm(a: number): B { const r = base(a); if (a & 1) { const c = r as C; c.c = 7; } else { const e = r as E; e.e = "x"; } return r; }
    function keptBefore(a: number): string { const r = base(a); const before = show(r); const c = r as C; const between = show(c); c.c = 8; return before + " | " + between + " | " + show(r); }
    function inLoop(n: number): string { const all: B[] = []; for (let i = 0; i < n; i++) { const r = base(i); all.push(r); if (i & 1) continue; const c = r as C; c.c = i; } return all.map(show).join(" ; "); }
    function order(a: number): string { const r = base(a); (r as any).z = 1; const d = r as D; d.d = 1; d.c = 2; return Object.keys(d).join(); }
    // The same without the hook: nothing is handed the object by `bare`, so each of these is decided by what stands between the allocation and the cast.
    function bare(a: number): B { return new M(a); }
    function bareAsC(a: number): C { const r = bare(a) as C; r.c = a + 1; return r; }
    function bareAsD(a: number): D { const r = bareAsC(a) as D; r.d = a + 2; return r; }
    function definedBefore(a: number): string { const r = bare(a); Object.defineProperty(r, "c", { value: "text", writable: true, enumerable: true, configurable: true }); const before = show(r); (r as any).c = 3; const c = r as C; return before + " | " + show(c); }
    function deletedBefore(a: number): string { const r = bare(a); r.o = a; delete r.o; const c = r as C; c.c = 1; return show(c) + " o " + ("o" in c); }
    function listedBefore(a: number): string { const r = bare(a); const k = Object.keys(r).join() + ("c" in r); const c = r as C; c.c = 1; return k + " " + show(c); }
    function swallowed(a: number): string { const r = bare(a); try { if (a & 1) throw new RangeError("x"); r.b = "set"; } catch { } const c = r as C; c.c = 4; return show(c); }
    function oldValueAfter(a: number): string { const r = bare(a); const c = r as C; c.c = 9; return show(r) + " " + (r === c); }
    function bareReturnsEarly(a: number): B { const r = bare(a); if (a & 1) return r; const c = r as C; c.c = 5; return c; }
    function bareKept(a: number): C { const r = bare(a); seen.push(r); const c = r as C; c.c = 6; return c; }
    function wrongStore(a: number): string { const r = bare(a); (r as any).c = "not a number"; const before = show(r); (r as any).c = 2; return before + " | " + show(r as C); }
    return { asC, asD, returnsEarly, throwsBefore, twoCasts, inOneArm, keptBefore, inLoop, order, bareAsC, bareAsD, definedBefore, deletedBefore, listedBefore, swallowed, oldValueAfter, bareReturnsEarly, bareKept, wrongStore };
}
function attempt(name: string, f: () => any) { try { const v = f(); log.push(name + ": " + (typeof v === "string" ? v : show(v))); } catch (e: any) { log.push(name + " threw " + e.constructor.name); } }
function all(label: string) {
    const f = factory();
    attempt(label + " asC", () => f.asC(1)); attempt(label + " asD", () => f.asD(2));
    attempt(label + " returnsEarly odd", () => f.returnsEarly(3)); attempt(label + " returnsEarly even", () => f.returnsEarly(4));
    attempt(label + " throwsBefore", () => f.throwsBefore(5)); attempt(label + " throwsBefore throws", () => f.throwsBefore(-5)); attempt(label + " what was seen", () => seen.map(show).join(" ; ")); seen.length = 0;
    attempt(label + " inOneArm odd", () => f.inOneArm(7)); attempt(label + " inOneArm even", () => f.inOneArm(8));
    attempt(label + " keptBefore", () => f.keptBefore(9)); attempt(label + " inLoop", () => f.inLoop(4)); attempt(label + " order", () => f.order(10));
    attempt(label + " bareAsC", () => f.bareAsC(11)); attempt(label + " bareAsD", () => f.bareAsD(12)); attempt(label + " definedBefore", () => f.definedBefore(13)); attempt(label + " deletedBefore", () => f.deletedBefore(14));
    attempt(label + " listedBefore", () => f.listedBefore(15)); attempt(label + " swallowed odd", () => f.swallowed(17)); attempt(label + " swallowed even", () => f.swallowed(18)); attempt(label + " oldValueAfter", () => f.oldValueAfter(19));
    attempt(label + " bareReturnsEarly odd", () => f.bareReturnsEarly(21)); attempt(label + " bareReturnsEarly even", () => f.bareReturnsEarly(22)); attempt(label + " bareKept", () => f.bareKept(23)); attempt(label + " what was kept", () => seen.map(show).join(" ; ")); seen.length = 0;
    attempt(label + " wrongStore", () => f.wrongStore(24));
}
all("plain");
hook = x => { seen.push(show(x)); }; all("hooked"); log.push(seen.join(" ; ")); seen.length = 0;
hook = x => { if (x.a === 2) throw new RangeError("hook"); }; all("hook throws");
hook = undefined; makers.get = () => Other as any; all("mispredicted");
console.log(log.join("\n"));
export {};
