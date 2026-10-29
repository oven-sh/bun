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
type K = E | null;
type Wide = { a?: number | null; k?: number | null; b?: number | null };
let current: any, below: any, pending: any, notes: string[] = [];
interface H { a: K; k: K; b: K; }
function make(): H { return { a: E.Seven, k: E.One, b: E.Nine }; }
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
async function t(name: string, f: (v: any, i: number) => unknown, first = never ? 0 : 2, count = 1): Promise<void> {
    for (let i = first; i < first + count; i++) {
        const v = values[i]; current = undefined; below = undefined; notes = [];
        let stored = "ok";
        try { await f(v, i); } catch (e) { stored = failed(e); }
        Bun.gc(true);
        const o = current;
        console.log(name + " | " + show(v) + " | " + typeof v + " | " + (o === undefined ? "-" : attempt(() => typeof o[key])) + " | store " + stored + " | notes " + notes.join(" ") + (o === undefined ? "" : " | typed; " + typedLooks(o, v) + " | untyped; " + untypedLooks(o, v)));
    }
}
await t("spread-later-name fresh", () => { const o: H = keep({ ...make(), k: (-1 as number) }); });
await t("from-entries sealed-out-of-slot", () => { const o = keep(Object.fromEntries([["a", E.Seven], ["k", (-1 as any)], ["b", E.Nine]]) as unknown as H); (o as any).k = half; Object.seal(o); });
await t("computed-name prototype", () => { const o = keep(make()); below = Object.create(o); (o as any)[key] = (-1 as any); });
await t("prefix-increment fresh", () => { const o = keep(make()); o.k = (-1 as number); note(++o.k!); });
await t("power late-fields", () => { const o = keep(make()); for (let i = 0; i < 40; i++) (o as any)["late" + i] = i; o.k = E.Two; o.k! **= -1; });
await t("add-to-the-value fresh", () => { const o = keep(make()); o.k = (-1 as number); o.k! += 1; });
await t("and-assign fresh", () => { const o = keep(make()); o.k &&= (-1 as number); });
await t("assign-wider-layout fresh", () => { const o = keep(make()); const s: Wide = { a: 7, k: (-1 as number), b: 9 }; Object.assign(o, s); });
await t("define-hidden not-extensible", () => { const o = keep(make()); Object.preventExtensions(o); Object.defineProperty(o, "k", { value: (-1 as any), enumerable: false }); });
await t("proxy-above fresh", () => { const o = keep(make()); Object.setPrototypeOf(o, new Proxy({}, {})); delete (o as any).k; o.k = (-1 as number); });
await t("after-await fresh", async () => { const o = keep(make()); await null; o.k = (-1 as number); });
await t("conditional sealed-out-of-slot", () => { const o = keep(make()); (o as any).k = half; Object.seal(o); o.k = never ? E.One : (-1 as number); });

// GENERATED: note mathK copied put
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
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]} illTypedCause=Assertion
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
// CHECK-LABEL: function {{*}}name="copied"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=7
// CHECK-NEXT: v2 = Convert v1 declared={type=null|i32}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=null|i32}
// CHECK-NEXT: v5 = Integer integer=9
// CHECK-NEXT: v6 = Convert v5 declared={type=null|i32}
// CHECK-NEXT: v7 = NewObject -, v2, v4, v6 layout=[[L_6]] fields=[0, 2, 1]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_6]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = PropGet v0 key="k"
// CHECK-NEXT: v11 = Convert v10 declared={type=null|i32 site=[[w_14]]}
// CHECK-NEXT: PropSet v9, v11 key="k"
// CHECK-NEXT: v13 = Convert v9 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="key"
// CHECK-NEXT: v16 = ElemGet v13, v15
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="put"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="put"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
