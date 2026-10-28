// A field whose type is an enum, a const enum or a union of integer literals takes any number, by any road, and every later look finds that number, the same keys and attributes, and the same neighbors.
// Each case makes an object, puts it into a state, stores each of the numbers below by one road, and prints what typed code, untyped code and evaluated text see afterwards.
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
class H { constructor(public a: K, public k: K, public b: K) {} }
function make(): H { return new H(E.Seven, E.One, E.Nine); }
const values: any[] = [0, 1, -1, 2147483647, 2147483646, -2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642, 2147483648, -2147483649, 4294967296, 9007199254740992, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e21, 5e-324];
const key: string = never ? "a" : "k";
const half: any = never ? 1 : 0.5;
const words = ["zero", "one", "two"];
function keep<T>(o: T): T { current = o; return o; }
function show(x: unknown): string {
    if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
    if (typeof x === "string") return JSON.stringify(x);
    if (typeof x === "bigint") return x + "n";
    if (typeof x === "object" && x !== null) return Array.isArray(x) ? "array" : "object";
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
function copied(o: H): unknown { const c = make(); c.k = o.k; return (c as any)[key]; }
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
await t("spread-later-name after-a-fraction-and-an-integer", v => { const o: H = keep({ ...make(), k: v }); (o as any).k = half; o.k = E.Two; });
await t("spread-source sealed-after-a-fraction", v => { const s = make(); s.k = v; const o: H = keep({ ...s }); (o as any).k = half; Object.seal(o); });
await t("spread-any-source prototype", v => { const s: any = { k: v }; const o: H = keep({ ...make(), ...s }); below = Object.create(o); });
await t("assign-fresh-literal seen-by-evaluated-text", v => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: v }) as H); unseen("o => { o.k; return Object.keys(o); }")(o); });
await t("assign-into-empty never-escapes", v => { const s = make(); s.k = v; const o = (Object.assign({}, s) as H); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("from-entries fresh", v => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", v], ["b", E.Nine]]) as unknown as H); });
await t("structured-clone frozen", v => { const s = make(); (s as any).k = v; const o: H = keep(structuredClone(s)); Object.freeze(o); });
await t("object-create sealed", v => { const o = keep(Object.create(Object.prototype, { a: { value: E.Seven, writable: true, enumerable: true, configurable: true }, k: { value: v, writable: true, enumerable: true, configurable: true }, b: { value: E.Nine, writable: true, enumerable: true, configurable: true } }) as H); Object.seal(o); });
await t("typed-store deleted", v => { const o = keep(make()); delete (o as any).k; o.k = v; });
await t("literal-name after-a-fraction", v => { const o = keep(make()); (o as any).k = half; o["k"] = v; });
await t("as-any sealed-after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); (o as any).k = v; });
await t("in-a-function fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; put(o, v); });
await t("wider-alias seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); (o as Wide).k = v; });
await t("increment late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = v; o.k!++; });
await t("prefix-increment fresh", v => { const o = keep(make()); o.k = v; note(++o.k!); });
await t("postfix-decrement-value fresh", v => { const o = keep(make()); o.k = v; note(o.k!--); });
await t("subtract sealed", v => { const o = keep(make()); Object.seal(o); o.k! -= v; });
await t("multiply not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k! *= v; });
await t("remainder after-a-fraction", v => { const o = keep(make()); (o as any).k = half; o.k = E.Seven; o.k! %= v; });
await t("power after-a-fraction-and-an-integer", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k = E.Two; o.k! **= v; });
await t("and fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = E.Seven; o.k! &= v; });
await t("xor prototype", v => { const o = keep(make()); below = Object.create(o); o.k! ^= v; });
await t("shift-right late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = E.Low; o.k! >>= v; });
await t("shift-right-unsigned never-escapes", v => { const o = (make()); o.k = E.Low; o.k! >>>= v; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("multiply-the-value fresh", v => { const o = keep(make()); o.k = v; o.k! *= 2; });
await t("negate-the-value frozen", v => { const o = keep(make()); Object.freeze(o); o.k = v; o.k = -o.k! as K; });
await t("halve-the-value not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k = v; o.k! /= 2; });
await t("nullish-assign deleted", v => { const o = keep(make()); delete (o as any).k; (o as any).k = undefined; o.k ??= v; });
await t("and-assign after-a-fraction-and-an-integer", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k &&= v; });
await t("destructure-object sealed-after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); ({ k: o.k } = { k: v }); });
await t("destructure-default prototype", v => { const o = keep(make()); below = Object.create(o); ({ k: o.k = v } = {} as { k?: K }); });
await t("for-of seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); for (o.k of [v]); });
await t("assign never-escapes", v => { const o = (make()); Object.assign(o, { k: v }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("assign-same-layout fresh", v => { const o = keep(make()); const s = make(); s.k = v; Object.assign(o, s); });
await t("reflect-set frozen", v => { const o = keep(make()); Object.freeze(o); Reflect.set(o, "k", v); });
await t("reflect-set-receiver sealed", v => { const o = keep(make()); Object.seal(o); Reflect.set(make(), "k", v, o); });
await t("define-value deleted", v => { const o = keep(make()); delete (o as any).k; Object.defineProperty(o, "k", { value: v }); });
await t("define-all after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { value: v, writable: true, enumerable: true, configurable: true }); });
await t("define-hidden sealed-after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.defineProperty(o, "k", { value: v, enumerable: false }); });
await t("define-properties fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; Object.defineProperties(o, { k: { value: v } }); });
await t("getter-then-value seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("super-store late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; putter.put.call(o, v); });
await t("proxy-above fresh", v => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = v; });
await t("evaluated-text sealed", v => { const o = keep(make()); Object.seal(o); unseen("(o, v) => { o.k = v; }")(o, v); });
await t("function-constructor not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); new Function("o", "v", "o.k = v;")(o, v); });
await t("sort after-a-fraction", v => { const o = keep(make()); (o as any).k = half; [2, 1].sort(() => { o.k = v; return 0; }); });
await t("replace after-a-fraction-and-an-integer", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; "a".replace("a", () => { o.k = v; return ""; }); });
await t("finally fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; try { throw 1; } catch {} finally { o.k = v; } });
await t("swap prototype", v => { const o = keep(make()); below = Object.create(o); o.a = v; const x = o.a; o.a = o.k; o.k = x; });
await t("copy-same-type late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; const s = make(); s.k = v; o.k = s.k; });
await t("copy-wider-type never-escapes", v => { const o = (make()); const s: Wide = { a: 7, k: v, b: 9 }; o.k = s.k as K; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("conditional fresh", v => { const o = keep(make()); o.k = never ? E.One : v; });
await t("twice frozen", v => { const o = keep(make()); Object.freeze(o); o.k = v; o.k = E.Two; o.k = v; });
await t("all-three deleted", v => { const o = keep(make()); delete (o as any).k; o.a = v; o.k = v; o.b = v; });
await t("count-up-add fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k! += 1; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-up-plain fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k = (o.k! + 1) as K; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-up-by-3 fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k! += 3; if (i >= 160 && i <= 170) note(o.k); } }, 0, 1);
await t("count-up-in-a-function fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { up(o); if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down never-escapes", v => { const o = (make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k!--; if (i >= 493 && i <= 507) note(o.k); } note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); }, 0, 1);
await t("count-down-subtract fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k! -= 1; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down-no-look fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) o.k!--; }, 0, 1);
await t("count-down-in-a-function fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { down(o); if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down-and-up fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) o.k!--; for (let i = 0; i < 1000; i++) { o.k!++; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("double after-a-fraction", v => { const o = keep(make()); (o as any).k = half; for (let i = 0; i < 40; i++) { o.k! *= 2; if (i >= 28 && i <= 33) note(o.k); } }, 0, 1);
await t("shift fresh", v => { const o = keep(make()); for (let i = 0; i < 40; i++) { o.k! <<= 1; if (i >= 28 && i <= 33) note(o.k); } }, 0, 1);
await t("halve fresh", v => { const o = keep(make()); o.k = E.Seven; for (let i = 0; i < 6; i++) { o.k! /= 2; note(o.k); } }, 0, 1);
await t("store-the-counter-down fresh", v => { const o = keep(make()); for (let i = -2147483143; i > -2147484143; i--) { o.k = i as K; if (i <= -2147483636 && i >= -2147483652) note(o.k); } }, 0, 1);
await t("many-objects fresh", v => { const o = keep(make()); const all: H[] = []; for (let i = 0; i < 1000; i++) { const each = make(); each.k = (-2147483143 - i) as K; all.push(each); } for (let i = 493; i <= 507; i++) note(all[i].a, all[i].k, all[i].b); }, 0, 1);
