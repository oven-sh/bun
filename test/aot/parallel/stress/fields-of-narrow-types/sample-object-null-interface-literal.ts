// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
class Ref { id = 1; }
const refs = [new Ref(), new Ref(), new Ref(), new Ref(), new Ref(), new Ref(), new Ref()];
type E = Ref;
type K = E | null;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a: K; k: K; b: K; }
function make(): H { return { a: refs[3], k: refs[1], b: refs[4] }; }
const sym = Symbol("s"), fn = function() {}, withValueOf = { valueOf() { return 3; } }, ref: any = new Ref();
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324, undefined, null, true, "1", "", 1n, {}, [2], sym, fn, withValueOf, false, ref];
const texts: string[] = ["{\"a\":{\"id\":1},\"k\":0,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":1,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-1,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":2147483647,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":2147483646,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483648,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483647,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483646,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483645,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483644,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483643,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483642,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":2147483648,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-2147483649,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":4294967296,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":9007199254740992,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":0.5,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-0.5,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-0,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":null,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":1e999,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":-1e999,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":1e21,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":5e-324,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":null,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":true,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":\"1\",\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":\"\",\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":{},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":[2],\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"k\":false,\"b\":{\"id\":1}}", "{\"a\":{\"id\":1},\"b\":{\"id\":1}}"];
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
function switchK(o: H): string { switch (o.k) { case refs[0]: return "zero"; case refs[1]: return "one"; case refs[2]: return "two"; case refs[3]: return "seven"; case refs[5]: return "top"; case refs[6]: return "low"; default: return "other"; } }
function indexK(o: H): unknown { return words[(o.k as unknown as number)]; }
function mathK(o: H): string { const n = (o.k as unknown as number); return [n + 1, n - 1, n | 0, n >>> 0, -n, n * 2, n < 2, n % 3, Math.floor(n)].map(show).join(" "); }
function nullishK(o: H): string { return [o.k == null, o.k === undefined, o.k === null, !o.k, o.k ?? "nullish"].map(show).join(" "); }
function neighbors(o: H): string { return show(o.a) + " " + show(o.b); }
function destructured(o: H): string { const { a, k, b } = o; return show(a) + " " + show(k) + " " + show(b); }
function copied(o: H): unknown { const c: H = { a: refs[3], k: refs[1], b: refs[4] }; c.k = o.k; return (c as any)[key]; }
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
await t("spread-later-name not-extensible", v => { const o: H = keep({ ...make(), k: v }); Object.preventExtensions(o); });
await t("spread-later-name through-text", v => { const o: H = keep({ ...make(), k: v }); unseen("o => { o.k; return Object.keys(o); }")(o); });
await t("spread-small-source prototype", v => { const o: H = keep({ ...make(), ...{ k: v } }); below = Object.create(o); });
await t("spread-small-source local", v => { const o: H = ({ ...make(), ...{ k: v } }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("assign-fresh-literal fresh", v => { const o = keep(Object.assign({ a: refs[3], k: refs[1], b: refs[4] }, { k: v }) as H); });
await t("assign-fresh-literal frozen", v => { const o = keep(Object.assign({ a: refs[3], k: refs[1], b: refs[4] }, { k: v }) as H); Object.freeze(o); });
await t("assign-into-empty sealed", v => { const s = make(); s.k = v; const o = keep(Object.assign({}, s) as H); Object.seal(o); });
await t("assign-into-empty sealed-out-of-slot", v => { const s = make(); s.k = v; const o = keep(Object.assign({}, s) as H); (o as any).k = half; Object.seal(o); });
await t("json-parse deleted", (v, i) => { const o = keep(JSON.parse(texts[i]) as H); delete (o as any).k; });
await t("json-parse fresh", (v, i) => { const o = keep(JSON.parse(texts[i]) as H); });
await t("object-create out-of-slot", v => { const o = keep(Object.create(Object.prototype, { a: { value: refs[3], writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: refs[4], writable: true, enumerable: true, configurable: true } }) as H); (o as any).k = half; });
await t("object-create out-and-back", v => { const o = keep(Object.create(Object.prototype, { a: { value: refs[3], writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: refs[4], writable: true, enumerable: true, configurable: true } }) as H); (o as any).k = half; o.k = refs[2]; });
await t("typed-store neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = v; });
await t("typed-store late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = v; });
await t("computed-name not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); (o as any)[key] = v; });
await t("computed-name through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); (o as any)[key] = v; });
await t("in-a-function prototype", v => { const o = keep(make()); below = Object.create(o); put(o, v); });
await t("in-a-function local", v => { const o = (make()); put(o, v); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("nullish-assign neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; (o as any).k = undefined; o.k ??= v; });
await t("nullish-assign late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; (o as any).k = undefined; o.k ??= v; });
await t("and-assign not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k &&= v; });
await t("and-assign through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k &&= v; });
await t("destructure-array prototype", v => { const o = keep(make()); below = Object.create(o); [o.k] = [v]; });
await t("destructure-array local", v => { const o = (make()); [o.k] = [v]; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("for-of fresh", v => { const o = keep(make()); for (o.k of [v]); });
await t("for-of frozen", v => { const o = keep(make()); Object.freeze(o); for (o.k of [v]); });
await t("assign sealed", v => { const o = keep(make()); Object.seal(o); Object.assign(o, { k: v }); });
await t("assign sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.assign(o, { k: v }); });
await t("reflect-set-receiver out-of-slot", v => { const o = keep(make()); (o as any).k = half; Reflect.set(make(), "k", v, o); });
await t("reflect-set-receiver out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = refs[2]; Reflect.set(make(), "k", v, o); });
await t("define-value neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; Object.defineProperty(o, "k", { value: v }); });
await t("define-value late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; Object.defineProperty(o, "k", { value: v }); });
await t("define-read-only not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { value: v, writable: false }); });
await t("define-read-only through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Object.defineProperty(o, "k", { value: v, writable: false }); });
await t("define-properties prototype", v => { const o = keep(make()); below = Object.create(o); Object.defineProperties(o, { k: { value: v } }); });
await t("define-properties local", v => { const o = (make()); Object.defineProperties(o, { k: { value: v } }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("getter-then-value fresh", v => { const o = keep(make()); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("getter-then-value frozen", v => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("setter-above sealed", v => { const o = keep(make()); Object.seal(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; });
await t("setter-above sealed-out-of-slot", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = v; });
await t("proxy-above deleted", v => { const o = keep(make()); delete (o as any).k; Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = v; });
await t("proxy-above fresh", v => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = v; });
await t("evaluated-text out-of-slot", v => { const o = keep(make()); (o as any).k = half; unseen("(o, v) => { o.k = v; }")(o, v); });
await t("evaluated-text out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = refs[2]; unseen("(o, v) => { o.k = v; }")(o, v); });
await t("for-each neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; [v].forEach(x => { o.k = x; }); });
await t("for-each late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; [v].forEach(x => { o.k = x; }); });
await t("replace not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); "a".replace("a", () => { o.k = v; return ""; }); });
await t("replace through-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); "a".replace("a", () => { o.k = v; return ""; }); });
await t("finally prototype", v => { const o = keep(make()); below = Object.create(o); try { throw 1; } catch {} finally { o.k = v; } });
await t("finally local", v => { const o = (make()); try { throw 1; } catch {} finally { o.k = v; } note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("swap-destructured fresh", v => { const o = keep(make()); o.a = v; [o.a, o.k] = [o.k, o.a]; });
await t("swap-destructured frozen", v => { const o = keep(make()); Object.freeze(o); o.a = v; [o.a, o.k] = [o.k, o.a]; });
await t("conditional deleted", v => { const o = keep(make()); delete (o as any).k; o.k = never ? refs[1] : v; });
await t("conditional fresh", v => { const o = keep(make()); o.k = never ? refs[1] : v; });
await t("back-to-an-integer out-of-slot", v => { const o = keep(make()); (o as any).k = half; o.k = v; o.k = refs[2]; });
await t("back-to-an-integer out-and-back", v => { const o = keep(make()); (o as any).k = half; o.k = refs[2]; o.k = v; o.k = refs[2]; });
await t("all-three neighbors-out-of-slot", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.a = v; o.k = v; o.b = v; });
await t("all-three late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.a = v; o.k = v; o.b = v; });
