// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
type E = number;
type K = E | null;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class Base { a: K; k: K; constructor(k: K) { this.a = 7; this.k = k; } }
class H extends Base { b: K = 9; }
function make(): H { return new H(1); }
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
function switchK(o: H): string { switch (o.k) { case 0: return "zero"; case 1: return "one"; case 2: return "two"; case 7: return "seven"; case 2147483647: return "top"; case -2147483643: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as number)]; }
function mathK(o: H): string { const n = (o.k as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: 7, k: 1, b: 9 }; c.k = o.k; return (c as any)[key]; }
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
await t("spread-small-source out-of-slot", v => { const o: H = keep({ ...make(), ...{ k: v } }); (o as any).k = half; });
await t("spread-small-source neighbors-out-of-slot", v => { const o: H = keep({ ...make(), ...{ k: v } }); (o as any).a = half; (o as any).b = half; });
await t("from-entries fresh", v => { const o = keep(Object.fromEntries([["a", 7], ["k", v], ["b", 9]]) as unknown as H); });
await t("typed-store deleted", v => { const o = keep(make()); delete (o as any).k; o.k = v; });
await t("typed-store sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = v; });
await t("in-an-untyped-function fresh", v => { const o = keep(make()); putAny(o, v); });
await t("postfix-decrement-value fresh", v => { const o = keep(make()); o.k = v; note(o.k!--); });
await t("postfix-decrement-value prototype", v => { const o = keep(make()); below = Object.create(o); o.k = v; note(o.k!--); });
await t("remainder fresh", v => { const o = keep(make()); o.k = 7; o.k! %= v; });
await t("shift-left through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k! <<= v; });
await t("shift-left late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k! <<= v; });
await t("negate-the-value fresh", v => { const o = keep(make()); o.k = v; o.k = -o.k! as K; });
await t("and-assign out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = 2; o.k &&= v; });
await t("and-assign fresh", v => { const o = keep(make()); o.k &&= v; });
await t("for-in fresh", v => { const o = keep(make()); for ((o as any).k in { 7: 0 }); }, 0, 1);
await t("reflect-set-receiver frozen", v => { const o = keep(make()); Object.freeze(o); Reflect.set(make(), "k", v, o); });
await t("reflect-set-receiver sealed", v => { const o = keep(make()); Object.seal(o); Reflect.set(make(), "k", v, o); });
await t("define-hidden fresh", v => { const o = keep(make()); Object.defineProperty(o, "k", { value: v, enumerable: false }); });
await t("setter-above not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; });
await t("setter-above local", v => { const o = (make()); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("function-constructor fresh", v => { const o = keep(make()); new Function("o", "v", "o.k = v;")(o, v); });
await t("finally out-of-slot", v => { const o = keep(make()); (o as any).k = half; try { throw 1; } catch {} finally { o.k = v; } });
await t("finally neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; try { throw 1; } catch {} finally { o.k = v; } });
await t("copy-neighbor fresh", v => { const o = keep(make()); o.a = v; o.k = o.a; o.b = o.k; });
await t("all-three deleted", v => { const o = keep(make()); delete (o as any).k; o.a = v; o.k = v; o.b = v; });
await t("all-three sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.a = v; o.k = v; o.b = v; });
await t("count-up-by-3 fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k! += 3; if (i >= 160 && i <= 170) note(o.k); } }, 0, 1);
await t("count-down-plain fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k = (o.k! - 1) as K; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("double fresh", v => { const o = keep(make()); for (let i = 0; i < 40; i++) { o.k! *= 2; if (i >= 28 && i <= 33) note(o.k); } }, 0, 1);
await t("store-the-counter-down fresh", v => { const o = keep(make()); for (let i = -2147483143; i > -2147484143; i--) { o.k = i as K; if (i <= -2147483636 && i >= -2147483652) note(o.k); } }, 0, 1);
