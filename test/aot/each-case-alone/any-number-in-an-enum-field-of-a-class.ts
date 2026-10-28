// A field whose type is an enum, a const enum or a union of integer literals takes any number, by any road, and every later look finds that number, the same keys and attributes, and the same neighbors.
// Each case makes an object, puts it into a state, stores each of the numbers below by one road, and prints what typed code, untyped code and evaluated text see afterwards.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
declare const Bun: { gc(force: boolean): void };
declare function structuredClone<T>(value: T): T;
const never = process.argv.length > 99;
const unseen = eval;
enum E { Zero = 0, One = 1, Two = 2, Seven = 7, Nine = 9, Top = 2147483647, Low = -2147483643 }
type K = E;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
class H { a: K; k: K; b: K; constructor(k: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; } }
function make(): H { return new H(E.One); }
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
function up(o: H): void { o.k++; }
function down(o: H): void { o.k--; }
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
await t("initial fresh", v => { const o: H = keep(new H(v)); });
await t("spread-later-name frozen", v => { const o: H = keep({ ...make(), k: v }); Object.freeze(o); });
await t("spread-small-source not-extensible", v => { const o: H = keep({ ...make(), ...{ k: v } }); Object.preventExtensions(o); });
await t("spread-any-source deleted", v => { const s: any = { k: v }; const o: H = keep({ ...make(), ...s }); delete (o as any).k; });
await t("assign-typed-literal after-a-fraction-and-an-integer", v => { const fresh: H = { a: E.Seven, k: E.One, b: E.Nine }; const o: H = keep(Object.assign(fresh, { k: v })); (o as any).k = half; o.k = E.Two; });
await t("assign-into-empty sealed-after-a-fraction", v => { const s = make(); s.k = v; const o = keep(Object.assign({}, s) as H); (o as any).k = half; Object.seal(o); });
await t("structured-clone seen-by-evaluated-text", v => { const s = make(); (s as any).k = v; const o: H = keep(structuredClone(s)); unseen("o => { o.k; return Object.keys(o); }")(o); });
await t("rest never-escapes", v => { const s = make(); s.k = v; const { ...o } = s; (o); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("typed-store fresh", v => { const o = keep(make()); o.k = v; });
await t("computed-name frozen", v => { const o = keep(make()); Object.freeze(o); (o as any)[key] = v; });
await t("as-any sealed", v => { const o = keep(make()); Object.seal(o); (o as any).k = v; });
await t("in-an-untyped-function deleted", v => { const o = keep(make()); delete (o as any).k; putAny(o, v); });
await t("wider-alias after-a-fraction", v => { const o = keep(make()); (o as any).k = half; (o as Wide).k = v; });
await t("decrement sealed-after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = v; o.k--; });
await t("prefix-increment fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = v; note(++o.k); });
await t("add seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); o.k += v; });
await t("subtract late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k -= v; });
await t("divide fresh", v => { const o = keep(make()); o.k /= v; });
await t("remainder fresh", v => { const o = keep(make()); o.k = E.Seven; o.k %= v; });
await t("or sealed", v => { const o = keep(make()); Object.seal(o); o.k |= v; });
await t("and not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); o.k = E.Seven; o.k &= v; });
await t("shift-left after-a-fraction", v => { const o = keep(make()); (o as any).k = half; o.k <<= v; });
await t("shift-right after-a-fraction-and-an-integer", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; o.k = E.Low; o.k >>= v; });
await t("add-to-the-value fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.k = v; o.k += 1; });
await t("multiply-the-value prototype", v => { const o = keep(make()); below = Object.create(o); o.k = v; o.k *= 2; });
await t("unsigned-value late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = v; o.k >>>= 0; });
await t("halve-the-value never-escapes", v => { const o = (make()); o.k = v; o.k /= 2; note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("or-assign fresh", v => { const o = keep(make()); o.k = E.Zero; o.k ||= v; });
await t("and-assign frozen", v => { const o = keep(make()); Object.freeze(o); o.k &&= v; });
await t("destructure-array not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); [o.k] = [v]; });
await t("destructure-default deleted", v => { const o = keep(make()); delete (o as any).k; ({ k: o.k = v } = {} as { k?: K }); });
await t("assign sealed-after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.seal(o); Object.assign(o, { k: v }); });
await t("assign-wider-layout prototype", v => { const o = keep(make()); below = Object.create(o); const s: Wide = { a: 7, k: v, b: 9 }; Object.assign(o, s); });
await t("reflect-set seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Reflect.set(o, "k", v); });
await t("reflect-set-empty-target never-escapes", v => { const o = (make()); Reflect.set({}, "k", v, o); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("define-value fresh", v => { const o = keep(make()); Object.defineProperty(o, "k", { value: v }); });
await t("define-read-only frozen", v => { const o = keep(make()); Object.freeze(o); Object.defineProperty(o, "k", { value: v, writable: false }); });
await t("define-hidden sealed", v => { const o = keep(make()); Object.seal(o); Object.defineProperty(o, "k", { value: v, enumerable: false }); });
await t("getter-over deleted", v => { const o = keep(make()); delete (o as any).k; Object.defineProperty(o, "k", { get() { return v; }, enumerable: true, configurable: true }); });
await t("getter-then-value after-a-fraction", v => { const o = keep(make()); (o as any).k = half; Object.defineProperty(o, "k", { get() { return 5; }, enumerable: true, configurable: true }); Object.defineProperty(o, "k", { value: v, writable: true }); });
await t("proxy-above-with-a-trap seen-by-evaluated-text", v => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); Object.setPrototypeOf(o, new Proxy({}, { set(target, name, x, receiver) { note("trap", x); return Reflect.set(target, name, x, receiver); } })); delete (o as any).k; o.k = v; });
await t("evaluated-text late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; unseen("(o, v) => { o.k = v; }")(o, v); });
await t("for-each fresh", v => { const o = keep(make()); [v].forEach(x => { o.k = x; }); });
await t("sort fresh", v => { const o = keep(make()); [2, 1].sort(() => { o.k = v; return 0; }); });
await t("after-await sealed", async v => { const o = keep(make()); Object.seal(o); await null; o.k = v; });
await t("finally not-extensible", v => { const o = keep(make()); Object.preventExtensions(o); try { throw 1; } catch {} finally { o.k = v; } });
await t("swap-destructured after-a-fraction", v => { const o = keep(make()); (o as any).k = half; o.a = v; [o.a, o.k] = [o.k, o.a]; });
await t("copy-same-type after-a-fraction-and-an-integer", v => { const o = keep(make()); (o as any).k = half; o.k = E.Two; const s = make(); s.k = v; o.k = s.k; });
await t("copy-neighbor fractions-beside-it", v => { const o = keep(make()); (o as any).a = half; (o as any).b = half; o.a = v; o.k = o.a; o.b = o.k; });
await t("conditional prototype", v => { const o = keep(make()); below = Object.create(o); o.k = never ? E.One : v; });
await t("back-to-an-integer late-fields", v => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = v; o.k = E.Two; });
await t("count-up fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k++; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-up-add fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k += 1; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-up-no-look fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) o.k++; }, 0, 1);
await t("count-up-by-3 fresh", v => { const o = keep(make()); o.k = (2147483147 as number); for (let i = 0; i < 1000; i++) { o.k += 3; if (i >= 160 && i <= 170) note(o.k); } }, 0, 1);
await t("count-up-sum fresh", v => { const o = keep(make()); o.k = (2147483147 as number); let sum = 0; for (let i = 0; i < 1000; i++) { o.k++; sum += (o.k as number) % 1000; } note(sum); }, 0, 1);
await t("count-down fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k--; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down-plain fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) { o.k = (o.k - 1) as K; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("count-down-no-look fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) o.k--; }, 0, 1);
await t("count-down-sum never-escapes", v => { const o = (make()); o.k = (-2147483143 as number); let sum = 0; for (let i = 0; i < 1000; i++) { o.k--; sum += (o.k as number) % 1000; } note(sum); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); }, 0, 1);
await t("count-down-and-up fresh", v => { const o = keep(make()); o.k = (-2147483143 as number); for (let i = 0; i < 1000; i++) o.k--; for (let i = 0; i < 1000; i++) { o.k++; if (i >= 493 && i <= 507) note(o.k); } }, 0, 1);
await t("double-negative fresh", v => { const o = keep(make()); for (let i = 0; i < 40; i++) { o.k *= -2; if (i >= 28 && i <= 33) note(o.k); } }, 0, 1);
await t("shift fresh", v => { const o = keep(make()); for (let i = 0; i < 40; i++) { o.k <<= 1; if (i >= 28 && i <= 33) note(o.k); } }, 0, 1);
await t("store-the-counter fresh", v => { const o = keep(make()); for (let i = 2147483147; i < 2147484147; i++) { o.k = i as K; if (i >= 2147483640 && i <= 2147483654) note(o.k); } }, 0, 1);
await t("store-the-counter-down after-a-fraction", v => { const o = keep(make()); (o as any).k = half; for (let i = -2147483143; i > -2147484143; i--) { o.k = i as K; if (i <= -2147483636 && i >= -2147483652) note(o.k); } }, 0, 1);
