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
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface Base { a: K; }
interface H extends Base { k: K; b: K; }
function HF(this: Base) { this.a = refs[3]; }
const HC = HF as unknown as new () => Base;
function grown(k: K): H { const o = new HC() as H; o.k = k; o.b = refs[4]; return o; }
function make(): H { return grown(refs[1]); }
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
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : 30, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("spread-any-source fresh", () => { const s: any = { k: ({} as any) }; const o: H = keep({ ...make(), ...s }); });
await t("object-create fresh", () => { const o = keep(Object.create(Object.prototype, { a: { value: refs[3], writable: true, enumerable: true, configurable: true }, k: { value: ({} as any), writable: true, enumerable: true, configurable: true }, b: { value: refs[4], writable: true, enumerable: true, configurable: true } }) as H); });
await t("in-an-untyped-function out-and-back", () => { const o = keep(make()); (o as any).k = half; o.k = refs[2]; putAny(o, ({} as any)); });
await t("for-of neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; for (o.k of [({} as any)]); });
await t("define-all fresh", () => { const o = keep(make()); Object.defineProperty(o, "k", { value: ({} as any), writable: true, enumerable: true, configurable: true }); });
await t("setter-above through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Object.setPrototypeOf(o, { set k(x: any) { note("setter", x); } }); delete (o as any).k; o.k = ({} as any); });
await t("sort local", () => { const o = (make()); [2, 1].sort(() => { o.k = ({} as any); return 0; }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as unknown as number), o.k === o.k); });
await t("copy-neighbor fresh", () => { const o = keep(make()); o.a = ({} as any); o.k = o.a; o.b = o.k; });
