// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = string;
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a?: K; k?: K; b?: K; }
function HF(this: H, k?: K) { this.a = "s"; this.k = k; this.b = "n"; }
const HC = HF as unknown as new (k?: K) => H;
function make(): H { return new HC("o"); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\"a\":\"s\",\"k\":0,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":1,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-1,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":2147483647,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":2147483646,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483648,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483647,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483646,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483645,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483644,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483643,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483642,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":2147483648,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-2147483649,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":4294967296,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":9007199254740992,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":0.5,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-0.5,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-0,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":null,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":1e999,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":-1e999,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":1e21,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":5e-324,\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}", "{\"a\":\"s\",\"k\":null,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":true,\"b\":\"n\"}", "{\"a\":\"s\",\"k\":\"1\",\"b\":\"n\"}", "{\"a\":\"s\",\"k\":\"\",\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}", "{\"a\":\"s\",\"k\":{},\"b\":\"n\"}", "{\"a\":\"s\",\"k\":[2],\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}", "{\"a\":\"s\",\"k\":false,\"b\":\"n\"}", "{\"a\":\"s\",\"b\":\"n\"}"];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : x === ref ? "ref" : "object";
    return typeof x === "symbol" || typeof x === "function" ? typeof x : String(x);
}
function note(...seen: unknown[]): void { for (const each of seen) notes.push(show(each)); }
function failed(e: unknown): string { return e instanceof Error ? e.name : "thrown " + show(e); }
function attempt(f: () => unknown): string { try { return show(f()); } catch (e) { return failed(e); } }
function put(o: H, v: K): void { o.k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { (o as any).k++; }
function down(o: H): void { (o as any).k--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as unknown as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case "z": return "zero"; case "o": return "one"; case "t": return "two"; case "s": return "seven"; case "top": return "top"; case "low": return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as unknown as number)]; }
function mathK(o: H): string { const n = (o.k as unknown as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: "s", k: "o", b: "n" }; c.k = o.k; return (c as any)[key]; }
function spreadK(o: H): unknown { const c = { ...o }; return c.k; }
function typedLooks(o: H, v: unknown): string {
    return [attempt(() => readK(o)), attempt(() => sameK(o, v)), attempt(() => typeK(o)), attempt(() => inverseK(o)), attempt(() => textK(o)), attempt(() => selfK(o)), attempt(() => switchK(o)), attempt(() => indexK(o)),
        attempt(() => mathK(o)), attempt(() => nullishK(o)), attempt(() => neighbors(o)), attempt(() => destructured(o)), attempt(() => copied(o)), attempt(() => spreadK(o))].join("; ");
}
function described(d: any): string { return d === undefined ? "none" : [show(d.value), d.writable, d.enumerable, d.configurable, typeof d.get, typeof d.set].join("/"); }
function inOrder(u: any): string { const seen: string[] = []; for (const name in u) seen.push(name); return seen.length + ":" + seen.slice(0, 5).join(); }
function untypedLooks(u: any, v: unknown): string {
    return [attempt(() => u[key]), attempt(() => Object.is(u[key], v)), attempt(() => 1 / u[key]), attempt(() => String(u[key])), attempt(() => u[key] === u[key]), attempt(() => key in u),
        attempt(() => Object.keys(u).length + ":" + Object.keys(u).slice(0, 5).join()), attempt(() => inOrder(u)), attempt(() => Reflect.ownKeys(u).length), attempt(() => (JSON.stringify(u) ?? "nothing").slice(0, 90)),
        attempt(() => described(Object.getOwnPropertyDescriptor(u, key))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "a"))), attempt(() => described(Object.getOwnPropertyDescriptor(u, "b"))),
        attempt(() => u.a), attempt(() => u.b), attempt(() => u.k), attempt(() => ({ ...u })[key]), attempt(() => Object.values(u).slice(0, 3).map(show).join()), attempt(() => Object.prototype.hasOwnProperty.call(u, key)),
        attempt(() => [Object.isFrozen(u), Object.isSealed(u), Object.isExtensible(u)].join()), attempt(() => below === undefined ? "-" : below[key]), attempt(() => unseen("o => o.k")(u))].join("; ");
}
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 1 : 0, count = values.length): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("initial deleted", v => { const o: H = keep(new HC(v)); delete (o as any).k; });
await t("initial prototype", v => { const o: H = keep(new HC(v)); below = Object.create(o); });
await t("spread-source frozen", v => { const s = make(); s.k = v; const o: H = keep({ ...s }); Object.freeze(o); });
await t("spread-source out-and-back", v => { const s = make(); s.k = v; const o: H = keep({ ...s }); (o as any).k = half; o.k = "t"; });
await t("spread-any-source sealed-out-of-slot", v => { const s: any = { k: v }; const o: H = keep({ ...make(), ...s }); (o as any).k = half; Object.seal(o); });
await t("spread-any-source neighbors-out-of-slot", v => { const s: any = { k: v }; const o: H = keep({ ...make(), ...s }); (o as any).a = half; (o as any).b = half; });
await t("assign-typed-literal through-text", v => { const fresh: H = { a: "s", k: "o", b: "n" }; const o: H = keep(Object.assign(fresh, { k: v })); unseen("o => { o.k; return Object.keys(o); }")(o); });
await t("assign-typed-literal fresh", v => { const fresh: H = { a: "s", k: "o", b: "n" }; const o: H = keep(Object.assign(fresh, { k: v })); });
await t("from-entries out-of-slot", v => { const o = keep(Object.fromEntries([["a", "s"], ["k", v], ["b", "n"]]) as unknown as H); (o as any).k = half; });
await t("from-entries local", v => { const o = (Object.fromEntries([["a", "s"], ["k", v], ["b", "n"]]) as unknown as H); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("structured-clone fresh", v => { const s = make(); (s as any).k = v; const o: H = keep(structuredClone(s)); });
await t("structured-clone late-fields", v => { const s = make(); (s as any).k = v; const o: H = keep(structuredClone(s)); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; });
await t("rest sealed", v => { const s = make(); s.k = v; const { ...o } = s; keep(o); Object.seal(o); });
await t("rest not-extensible", v => { const s = make(); s.k = v; const { ...o } = s; keep(o); Object.preventExtensions(o); });
await t("literal-name deleted", v => { const o = keep(make()); delete (o as any).k; o["k"] = v; });
await t("literal-name prototype", v => { const o = keep(make()); below = Object.create(o); o["k"] = v; });
await t("as-any frozen", v => { const o = keep(make()); Object.freeze(o); (o as any).k = v; });
await t("as-any out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = "t"; (o as any).k = v; });
await t("in-an-untyped-function sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); putAny(o, v); });
await t("in-an-untyped-function neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; putAny(o, v); });
await t("or-assign deleted", v => { const o = keep(make()); delete (o as any).k; o.k = "z"; o.k ||= v; });
await t("or-assign prototype", v => { const o = keep(make()); below = Object.create(o); o.k = "z"; o.k ||= v; });
await t("destructure-object frozen", v => { const o = keep(make()); Object.freeze(o); ({ k: o.k } = { k: v }); });
await t("destructure-object out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = "t"; ({ k: o.k } = { k: v }); });
await t("destructure-default sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); ({ k: o.k = v } = {} as { k?: K }); });
await t("destructure-default neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; ({ k: o.k = v } = {} as { k?: K }); });
await t("for-in through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); for ((o as any).k in { 7: 0 }); }, 0, 1);
await t("for-in fresh", v => { const o = keep(make()); for ((o as any).k in { 7: 0 }); }, 0, 1);
await t("assign-same-layout out-of-slot", v => { const o = keep(make()); (o as any).k = half; const s = make(); s.k = v; Object.assign(o, s); });
await t("assign-same-layout local", v => { const o = (make()); const s = make(); s.k = v; Object.assign(o, s); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("reflect-set fresh", v => { const o = keep(make()); Reflect.set(o, "k", v); });
await t("reflect-set late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Reflect.set(o, "k", v); });
await t("reflect-set-empty-target sealed", v => { const o = keep(make()); Object.seal(o); Reflect.set({}, "k", v, o); });
await t("reflect-set-empty-target not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); Reflect.set({}, "k", v, o); });
await t("define-all deleted", v => { const o = keep(make()); delete (o as any).k; Object.defineProperty(o, "k", { value: v, writable: true, enumerable: true, configurable: true }); });
await t("define-all prototype", v => { const o = keep(make()); below = Object.create(o); Object.defineProperty(o, "k", { value: v, writable: true, enumerable: true, configurable: true }); });
await t("define-hidden frozen", v => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { value: v, enumerable: false }); });
await t("define-hidden out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = "t"; Object.defineProperty(o, "k", { value: v, enumerable: false }); });
await t("getter-over sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.defineProperty(o, "k", { get() { return v; }, enumerable: true, configurable: true }); });
await t("getter-over neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; Object.defineProperty(o, "k", { get() { return v; }, enumerable: true, configurable: true }); });
await t("super-store through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); putter.put.call(o, v); });
await t("super-store fresh", v => { const o = keep(make()); putter.put.call(o, v); });
await t("setter-on-the-prototype out-of-slot", v => { const o = keep(make()); (o as any).k = half; const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = v; } finally { delete above.k; } });
await t("setter-on-the-prototype local", v => { const o = (make()); const above = Object.getPrototypeOf(o); Object.defineProperty(above, "k", { set(x: any) { note("setter", x); }, configurable: true }); try { delete (o as any).k; o.k = v; } finally { delete above.k; } note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("proxy-above-with-a-trap fresh", v => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = v; });
await t("proxy-above-with-a-trap late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = v; });
await t("function-constructor sealed", v => { const o = keep(make()); Object.seal(o); new Function("o", "v", "o.k = v;")(o, v); });
await t("function-constructor not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); new Function("o", "v", "o.k = v;")(o, v); });
await t("sort deleted", v => { const o = keep(make()); delete (o as any).k; [2, 1].sort(() => { o.k = v; return 0; }); });
await t("sort prototype", v => { const o = keep(make()); below = Object.create(o); [2, 1].sort(() => { o.k = v; return 0; }); });
await t("after-await frozen", async v => { const o = keep(make()); Object.freeze(o); await null; o.k = v; });
await t("after-await out-and-back", async v => { const o = keep(make()); (o as any).k = half; o.k = "t"; await null; o.k = v; });
await t("swap sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.a = v; const x = o.a; o.a = o.k; o.k = x; });
await t("swap neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.a = v; const x = o.a; o.a = o.k; o.k = x; });
await t("copy-same-type through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); const s = make(); s.k = v; o.k = s.k; });
await t("copy-same-type fresh", v => { const o = keep(make()); const s = make(); s.k = v; o.k = s.k; });
await t("copy-neighbor out-of-slot", v => { const o = keep(make()); (o as any).k = half; o.a = v; o.k = o.a; o.b = o.k; });
await t("copy-neighbor local", v => { const o = (make()); o.a = v; o.k = o.a; o.b = o.k; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("twice fresh", v => { const o = keep(make()); o.k = v; o.k = "t"; o.k = v; });
await t("twice late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = v; o.k = "t"; o.k = v; });
await t("delete-after sealed", v => { const o = keep(make()); Object.seal(o); o.k = v; delete (o as any).k; });
await t("delete-after not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k = v; delete (o as any).k; });
