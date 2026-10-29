// RUN: lower
// OPTIONS: builtin-modules

// A field whose type is an enum, a const enum or a union of integer literals takes any JavaScript value, by any road, and every later look finds that value, the same keys and attributes, and the same neighbors.
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
class H { readonly a: K; readonly k: K; readonly b: K; constructor(k: K) { this.a = E.Seven; this.k = k; this.b = E.Nine; } }
type Writable = { -readonly [P in keyof H]: H[P] };
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
function put(o: H, v: K): void { (o as Writable).k = v; }
function putAny(o: any, v: any): void { o.k = v; }
function up(o: H): void { (o as Writable).k++; }
function down(o: H): void { (o as Writable).k--; }
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
function copied(o: H): unknown { const c: H = { a: E.Seven, k: E.One, b: E.Nine }; (c as Writable).k = o.k; return (c as any)[key]; }
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
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : 17, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("assign-fresh-literal fresh", () => { const o = keep(Object.assign({ a: E.Seven, k: E.One, b: E.Nine }, { k: (-0.5 as any) }) as H); });
await t("rest deleted", () => { const s = make(); (s as Writable).k = (-0.5 as number); const { ...o } = s; keep(o); delete (o as any).k; });
await t("wider-alias fresh", () => { const o = keep(make()); (o as Wide).k = (-0.5 as number); });
await t("multiply fresh", () => { const o = keep(make()); (o as Writable).k *= -0.5; });
await t("shift-left neighbors-out-of-slot", () => { const o = keep(make()); (o as any).a = half; (o as any).b = half; (o as Writable).k <<= -0.5; });
await t("halve-the-value through-text", () => { const o = keep(make()); unseen("o => { o.k; return Object.keys(o); }")(o); (o as Writable).k = (-0.5 as number); (o as Writable).k /= 2; });
await t("for-of fresh", () => { const o = keep(make()); for ((o as Writable).k of [(-0.5 as number)]); });
await t("define-value local", () => { const o = (make()); Object.defineProperty(o, "k", { value: (-0.5 as any) }); note(o.a, o.k, o.b, typeof o.k, 1 / (o.k as number), o.k === o.k); });
await t("super-store fresh", () => { const o = keep(make()); putter.put.call(o, (-0.5 as any)); });
await t("for-each fresh", () => { const o = keep(make()); [(-0.5 as number)].forEach(x => { (o as Writable).k = x; }); });
await t("copy-same-type fresh", () => { const o = keep(make()); const s = make(); (s as Writable).k = (-0.5 as number); (o as Writable).k = s.k; });
await t("all-three deleted", () => { const o = keep(make()); delete (o as any).k; (o as Writable).a = (-0.5 as number); (o as Writable).k = (-0.5 as number); (o as Writable).b = (-0.5 as number); });

// GENERATED: note mathK spreadK put
// CHECK-LABEL: function {{*}}name="note"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v3 = IteratorResume v1
// CHECK-NEXT: v4 = ResultAt v3
// CHECK-NEXT: v5 = ResultAt v3 index=1
// CHECK-NEXT: Branch v4 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="notes"
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = Call v10, -, v5 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Call v9, v8, v12 calleeKey="push" calleeName="notes.push"
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v1:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mathK"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="k"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Sub v2, v5
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = BitOr v2, v7
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = URShift v2, v9
// CHECK-NEXT: v11 = Negate v2
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: v13 = Mul v2, v12
// CHECK-NEXT: v14 = Integer integer=2
// CHECK-NEXT: v15 = Less v2, v14
// CHECK-NEXT: v16 = Integer integer=3
// CHECK-NEXT: v17 = Mod v2, v16
// CHECK-NEXT: v18 = Builtin builtin=Math
// CHECK-NEXT: v19 = Builtin builtin=MathFloor
// CHECK-NEXT: v20 = Call v19, v18, v2 calleeName="Math.floor"
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_10]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = NewArray v4, v6, v8, v10, v11, v13, v15, v17, v21 contents=boolean|number
// CHECK-NEXT: v23 = PropGet v22 key="map"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v25 = Call v23, v22, v24 calleeKey="map" calleeName="map"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v27 = PropGet v26 key="join"
// CHECK-NEXT: v28 = String string=" "
// CHECK-NEXT: v29 = Call v27, v26, v28 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v29 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spreadK"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_13]]
// CHECK-NEXT: CopyDataProperties v1, v0
// CHECK-NEXT: v3 = FinishObject v1
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="k"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="put"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 captures=[{type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: object, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: SuperSet v3, v1, v2 key="k"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
