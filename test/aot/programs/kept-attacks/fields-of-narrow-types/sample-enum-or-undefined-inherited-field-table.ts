// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E | undefined;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class Base { a: K; k: K; constructor(k: K) { this.a = E.Seven; this.k = k; } }
class H extends Base { b: K = E.Nine; }
function make(): H { return new H(E.One); }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = { id: 1 };
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\"a\":7,\"k\":0,\"b\":9}", "{\"a\":7,\"k\":1,\"b\":9}", "{\"a\":7,\"k\":-1,\"b\":9}", "{\"a\":7,\"k\":2147483647,\"b\":9}", "{\"a\":7,\"k\":2147483646,\"b\":9}", "{\"a\":7,\"k\":-2147483648,\"b\":9}", "{\"a\":7,\"k\":-2147483647,\"b\":9}", "{\"a\":7,\"k\":-2147483646,\"b\":9}", "{\"a\":7,\"k\":-2147483645,\"b\":9}", "{\"a\":7,\"k\":-2147483644,\"b\":9}", "{\"a\":7,\"k\":-2147483643,\"b\":9}", "{\"a\":7,\"k\":-2147483642,\"b\":9}", "{\"a\":7,\"k\":2147483648,\"b\":9}", "{\"a\":7,\"k\":-2147483649,\"b\":9}", "{\"a\":7,\"k\":4294967296,\"b\":9}", "{\"a\":7,\"k\":9007199254740992,\"b\":9}", "{\"a\":7,\"k\":0.5,\"b\":9}", "{\"a\":7,\"k\":-0.5,\"b\":9}", "{\"a\":7,\"k\":-0,\"b\":9}", "{\"a\":7,\"k\":null,\"b\":9}", "{\"a\":7,\"k\":1e999,\"b\":9}", "{\"a\":7,\"k\":-1e999,\"b\":9}", "{\"a\":7,\"k\":1e21,\"b\":9}", "{\"a\":7,\"k\":5e-324,\"b\":9}", "{\"a\":7,\"b\":9}", "{\"a\":7,\"k\":null,\"b\":9}", "{\"a\":7,\"k\":true,\"b\":9}", "{\"a\":7,\"k\":\"1\",\"b\":9}", "{\"a\":7,\"k\":\"\",\"b\":9}", "{\"a\":7,\"b\":9}", "{\"a\":7,\"k\":{},\"b\":9}", "{\"a\":7,\"k\":[2],\"b\":9}", "{\"a\":7,\"b\":9}", "{\"a\":7,\"b\":9}", "{\"a\":7,\"b\":9}", "{\"a\":7,\"k\":false,\"b\":9}", "{\"a\":7,\"b\":9}"];
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
function up(o: H): void { o.k!++; }
function down(o: H): void { o.k!--; }
const putter = { put(this: any, v: any) {
    // @ts-ignore
    super.k = v;
} };
function readK(o: H): unknown { return o.k; }
function sameK(o: H, v: unknown): boolean { return Object.is(o.k, v); }
function typeK(o: H): string { return typeof o.k; }
function inverseK(o: H): number { return 1 / (o.k as number); }
function textK(o: H): string { return String(o.k); }
function selfK(o: H): boolean { return o.k === o.k; }
function switchK(o: H): string { switch (o.k) { case E.Zero: return "zero"; case E.One: return "one"; case E.Two: return "two"; case E.Seven: return "seven"; case E.Top: return "top"; case E.Low: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; c.k = o.k; return (c as any)[key]; }
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
await t("spread-later-name fresh", v => { const o: H = keep({ ...make(), k: v }); });
await t("assign-typed-literal neighbors-out-of-slot", v => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: v })); (o as any).a = half; (o as any).b = half; });
await t("assign-typed-literal late-fields", v => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: v })); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; });
await t("object-create fresh", v => { const o = keep(Object.create(Object.prototype, { a: { value: E.Seven, writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: E.Nine, writable: true, enumerable: true, configurable: true } }) as H); });
await t("as-any deleted", v => { const o = keep(make()); delete (o as any).k; (o as any).k = v; });
await t("as-any fresh", v => { const o = keep(make()); (o as any).k = v; });
await t("decrement fresh", v => { const o = keep(make()); o.k = v; o.k!--; });
await t("multiply fresh", v => { const o = keep(make()); o.k! *= v; });
await t("multiply frozen", v => { const o = keep(make()); Object.freeze(o); o.k! *= v; });
await t("and fresh", v => { const o = keep(make()); o.k = E.Seven; o.k! &= v; });
await t("add-to-the-value not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k = v; o.k! += 1; });
await t("add-to-the-value through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = v; o.k! += 1; });
await t("nullish-assign fresh", v => { const o = keep(make()); (o as any).k = undefined; o.k ??= v; });
await t("destructure-default out-of-slot", v => { const o = keep(make()); (o as any).k = half; ({ k: o.k = v } = {} as { k?: K }); });
await t("destructure-default out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; ({ k: o.k = v } = {} as { k?: K }); });
await t("assign-wider-layout fresh", v => { const o = keep(make()); const s: Wide = { a: 7, k: v, b: 9 }; Object.assign(o, s); });
await t("define-all sealed", v => { const o = keep(make()); Object.seal(o); Object.defineProperty(o, "k", { value: v, writable: true, enumerable: true, configurable: true }); });
await t("define-all sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.defineProperty(o, "k", { value: v, writable: true, enumerable: true, configurable: true }); });
await t("getter-then-value fresh", v => { const o = keep(make()); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("proxy-above-with-a-trap prototype", v => { const o = keep(make()); below = Object.create(o); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = v; });
await t("proxy-above-with-a-trap local", v => { const o = (make()); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = v; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("replace fresh", v => { const o = keep(make()); "a".replace("a", () => { o.k = v; return ""; }); });
await t("copy-same-type neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; const s = make(); s.k = v; o.k = s.k; });
await t("copy-same-type late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; const s = make(); s.k = v; o.k = s.k; });
await t("back-to-an-integer fresh", v => { const o = keep(make()); o.k = v; o.k = E.Two; });
await t("count-up-plain fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k = (o.k! + 1) as K; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k!--; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down-sum fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); let sum = 0; for (let i = 0; i < 1000; i++) { o.k!--; sum += (o.k as number) % 1000; } note(sum); }, 0, 1);
await t("halve fresh", v => { const o = keep(make()); o.k = E.Seven; for (let i = 0; i < 6; i++) { o.k! /= 2; note(o.k); } }, 0, 1);
