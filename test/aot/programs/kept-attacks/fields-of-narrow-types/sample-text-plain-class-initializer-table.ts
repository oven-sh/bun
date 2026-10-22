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
class H { a: K = "s"; k: K = "o"; b: K = "n"; }
class HI { a: K = "s"; k: K = pending; b: K = "n"; }
function make(): H { return new H(); }
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
await t("spread-later-name out-of-slot", v => { const o: H = keep({ ...make(), k: v }); (o as any).k = half; });
await t("spread-later-name local", v => { const o: H = ({ ...make(), k: v }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("spread-small-source fresh", v => { const o: H = keep({ ...make(), ...{ k: v } }); });
await t("spread-small-source late-fields", v => { const o: H = keep({ ...make(), ...{ k: v } }); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; });
await t("assign-fresh-literal sealed", v => { const o = keep(Object.assign({ a: "s", k: "o", b: "n" }, { k: v }) as H); Object.seal(o); });
await t("assign-fresh-literal not-extensible", v => { const o = keep(Object.assign({ a: "s", k: "o", b: "n" }, { k: v }) as H); Object.preventExtensions(o); });
await t("assign-into-empty deleted", v => { const s = make(); s.k = v; const o = keep(Object.assign({}, s) as H); delete (o as any).k; });
await t("assign-into-empty prototype", v => { const s = make(); s.k = v; const o = keep(Object.assign({}, s) as H); below = Object.create(o); });
await t("json-parse frozen", (v, i) => { const o = keep(JSON.parse(texts[i]) as H); Object.freeze(o); });
await t("json-parse out-and-back", (v, i) => { const o = keep(JSON.parse(texts[i]) as H); (o as any).k = half; o.k = "t"; });
await t("object-create sealed-out-of-slot", v => { const o = keep(Object.create(Object.prototype, { a: { value: "s", writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: "n", writable: true, enumerable: true, configurable: true } }) as H); (o as any).k = half; Object.seal(o); });
await t("object-create neighbors-out-of-slot", v => { const o = keep(Object.create(Object.prototype, { a: { value: "s", writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: "n", writable: true, enumerable: true, configurable: true } }) as H); (o as any).a = half; (o as any).b = half; });
await t("typed-store through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k = v; });
await t("typed-store fresh", v => { const o = keep(make()); o.k = v; });
await t("computed-name out-of-slot", v => { const o = keep(make()); (o as any).k = half; (o as any)[key] = v; });
await t("computed-name local", v => { const o = (make()); (o as any)[key] = v; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("in-a-function fresh", v => { const o = keep(make()); put(o, v); });
await t("in-a-function late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; put(o, v); });
await t("nullish-assign through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); (o as any).k = undefined; o.k ??= v; });
await t("nullish-assign fresh", v => { const o = keep(make()); (o as any).k = undefined; o.k ??= v; });
await t("and-assign out-of-slot", v => { const o = keep(make()); (o as any).k = half; o.k &&= v; });
await t("and-assign local", v => { const o = (make()); o.k &&= v; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("destructure-array fresh", v => { const o = keep(make()); [o.k] = [v]; });
await t("destructure-array late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; [o.k] = [v]; });
await t("for-of sealed", v => { const o = keep(make()); Object.seal(o); for (o.k of [v]); });
await t("for-of not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); for (o.k of [v]); });
await t("assign deleted", v => { const o = keep(make()); delete (o as any).k; Object.assign(o, { k: v }); });
await t("assign prototype", v => { const o = keep(make()); below = Object.create(o); Object.assign(o, { k: v }); });
await t("reflect-set-receiver sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Reflect.set(make(), "k", v, o); });
await t("reflect-set-receiver neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; Reflect.set(make(), "k", v, o); });
await t("define-value through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Object.defineProperty(o, "k", { value: v }); });
await t("define-value fresh", v => { const o = keep(make()); Object.defineProperty(o, "k", { value: v }); });
await t("define-read-only out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { value: v, writable: false }); });
await t("define-read-only local", v => { const o = (make()); Object.defineProperty(o, "k", { value: v, writable: false }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("define-properties fresh", v => { const o = keep(make()); Object.defineProperties(o, { k: { value: v } }); });
await t("define-properties late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Object.defineProperties(o, { k: { value: v } }); });
await t("getter-then-value sealed", v => { const o = keep(make()); Object.seal(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("getter-then-value not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("setter-above deleted", v => { const o = keep(make()); delete (o as any).k; Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; });
await t("setter-above prototype", v => { const o = keep(make()); below = Object.create(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; });
await t("proxy-above frozen", v => { const o = keep(make()); Object.freeze(o); Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = v; });
await t("proxy-above out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = "t"; Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = v; });
await t("evaluated-text sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); unseen("(o, v) => { o.k = v; }")(o, v); });
await t("evaluated-text neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; unseen("(o, v) => { o.k = v; }")(o, v); });
await t("for-each through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); [v].forEach(x => { o.k = x; }); });
await t("for-each fresh", v => { const o = keep(make()); [v].forEach(x => { o.k = x; }); });
await t("replace out-of-slot", v => { const o = keep(make()); (o as any).k = half; "a".replace("a", () => { o.k = v; return ""; }); });
await t("replace local", v => { const o = (make()); "a".replace("a", () => { o.k = v; return ""; }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("finally fresh", v => { const o = keep(make()); try { throw 1; } catch {} finally { o.k = v; } });
await t("finally late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; try { throw 1; } catch {} finally { o.k = v; } });
await t("swap-destructured sealed", v => { const o = keep(make()); Object.seal(o); o.a = v; [o.a, o.k] = [o.k, o.a]; });
await t("swap-destructured not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.a = v; [o.a, o.k] = [o.k, o.a]; });
await t("conditional frozen", v => { const o = keep(make()); Object.freeze(o); o.k = never ? "o" : v; });
await t("conditional out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = "t"; o.k = never ? "o" : v; });
await t("back-to-an-integer sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = v; o.k = "t"; });
await t("back-to-an-integer neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = v; o.k = "t"; });
await t("all-three through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.a = v; o.k = v; o.b = v; });
await t("all-three fresh", v => { const o = keep(make()); o.a = v; o.k = v; o.b = v; });
