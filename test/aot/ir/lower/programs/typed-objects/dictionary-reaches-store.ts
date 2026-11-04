// RUN: lower
// OPTIONS: builtin-modules

// A record enters a type with an index signature that takes more than its field holds. Each row: another way for that dictionary to get to a store.
// Every store is legal TypeScript without a cast of the record, so none is refused.
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }

type A = { v: number; a: number };
type WideA = { [key: string]: number | string | A };
function storeA(into: WideA): void { into.v = "a"; }
function handOnA(into: WideA): void { storeA(into); }
const a: A = { v: 1, a: 1 };
console.log("handed on", attempt(() => { handOnA(a); return JSON.stringify(a); }));

type B = { v: number; b: number };
type WideB = { [key: string]: number | string | B };
function giveBackB(what: WideB): WideB { return what; }
const b: B = { v: 1, b: 1 };
console.log("returned", attempt(() => { giveBackB(b).v = "b"; return JSON.stringify(b); }));

type C = { v: number; c: number };
type WideC = { [key: string]: number | string | C };
class Keeper { kept: WideC; constructor(kept: WideC) { this.kept = kept; } store(): void { this.kept.v = "c"; } }
const c: C = { v: 1, c: 1 };
console.log("kept in a field", attempt(() => { new Keeper(c).store(); return JSON.stringify(c); }));

type D = { v: number; d: number };
type WideD = { [key: string]: number | string | D };
function later(what: WideD): () => void { return () => { what["v"] = "d"; }; }
const d: D = { v: 1, d: 1 };
console.log("kept in a closure", attempt(() => { later(d)(); return JSON.stringify(d); }));

type E = { v: number; e: number };
type WideE = { [key: string]: number | string | boolean };
function toAny(what: WideE): void { const loose: any = what; loose.v = "e"; }
const e: E = { v: 1, e: 1 };
console.log("a variable of any", attempt(() => { toAny(e); return JSON.stringify(e); }));

type F = { v: number; f: number };
type WideF = { [key: string]: number | string | null };
function storesIntoAnything(what: any): void { what.v = "f"; }
function toParameter(what: WideF): void { storesIntoAnything(what); }
const f: F = { v: 1, f: 1 };
console.log("a parameter of any", attempt(() => { toParameter(f); return JSON.stringify(f); }));

type G = { v: number; g: number };
type WideG = { [key: string]: number | string | undefined };
function assigns(what: WideG): void { Object.assign(what, { v: "g" }); }
const g: G = { v: 1, g: 1 };
console.log("Object.assign", attempt(() => { assigns(g); return JSON.stringify(g); }));

type H = { v: number; h: number };
type WideH = { [key: string]: number | string | symbol };
function reflects(what: WideH): void { Reflect.set(what, "v", "h"); }
const h: H = { v: 1, h: 1 };
console.log("Reflect.set", attempt(() => { reflects(h); return JSON.stringify(h); }));

type I = { v: number; i: number };
type WideI = { [key: string]: number | string | bigint };
function defines(what: WideI): void { Object.defineProperty(what, "v", { value: "i", writable: true, enumerable: true, configurable: true }); }
const i: I = { v: 1, i: 1 };
console.log("Object.defineProperty", attempt(() => { defines(i); return JSON.stringify(i); }));

type J = { v: number; j: number };
type WideJ = { [key: string]: number | string | number[] };
type WiderJ = { [key: string]: unknown };
function storeJ(into: WiderJ): void { into.v = "j"; }
function widenJ(into: WideJ): void { storeJ(into); }
const j: J = { v: 1, j: 1 };
console.log("a wider dictionary", attempt(() => { widenJ(j); return JSON.stringify(j); }));

type K = { v: number; k: number };
type WideK = { [key: string]: number | string | string[] };
const held: WideK[] = [];
const k: K = { v: 1, k: 1 };
console.log("kept in an array", attempt(() => { held.push(k); held[0].v = "k"; return JSON.stringify(k); }));

type L = { v: number; l: number };
type WideL = { [key: string]: number | string | boolean[] };
function each<T extends WideL>(what: T): void { const seen: WideL = what; seen.v = "l"; }
const l: L = { v: 1, l: 1 };
console.log("a type parameter", attempt(() => { each(l); return JSON.stringify(l); }));

type M = { v: number; m: number };
type WideM = { [key: string]: number | string | Date };
function compound(what: WideM): void { what.v += "m"; }
const m: M = { v: 1, m: 1 };
console.log("a compound store", attempt(() => { compound(m); return JSON.stringify(m); }));

type N = { v: number; n: number };
type WideN = { [key: string]: number | string | N };
const n: N = { v: 1, n: 1 };
console.log("a variable", attempt(() => { const seen: WideN = n; seen.v = "n"; return JSON.stringify(n); }));

type O = { v: number; o: number };
type WideO = { [key: string]: number | string | O };
const o: O = { v: 1, o: 1 };
console.log("a key that is computed", attempt(() => { const seen: WideO = o; for (const key of ["v"]) seen[key] = "o"; return JSON.stringify(o); }));

type Q = { v: number; q: number };
type WideQ = { [key: string]: number | string | Q };
function pick(first: WideQ, second: WideQ, isFirst: boolean): WideQ { return isFirst ? first : second; }
const q: Q = { v: 1, q: 1 };
console.log("one of two", attempt(() => { pick(q, { w: 2 }, q.q === 1).v = "q"; return JSON.stringify(q); }));

// GENERATED: reflects defines compound attempt Keeper
// CHECK-LABEL: function {{*}}name="reflects"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectSet
// CHECK-NEXT: v3 = String string="v"
// CHECK-NEXT: v4 = String string="h"
// CHECK-NEXT: v5 = Call v2, v1, v0, v3, v4 calleeName="Reflect.set"
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="defines"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v3 = String string="v"
// CHECK-NEXT: v4 = String string="i"
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean}
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|boolean}
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|boolean}
// CHECK-NEXT: v11 = NewObject -, v4, v6, v8, v10 layout=[[L_1]] fields=[4, 5, 1, 0]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: v13 = Call v2, v1, v0, v3, v12 calleeName="Object.defineProperty"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="compound"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = PropGet v0 key="v"
// CHECK-NEXT: v2 = String string="m"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: PropSet v0, v3 key="v"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="constructor"
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Keeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: PropSet v4, v1 key="kept"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
