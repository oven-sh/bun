// RUN: lower
// OPTIONS: builtin-modules

// Enums (computed, merged, const, negative, fractional, with duplicate values and odd names, changed through any) and namespaces (merged, nested, dotted, over functions, classes and enums, with destructured exports, import aliases and shadowed names).
function show(label: string, f: () => unknown) {
    try { console.log(label, JSON.stringify(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
// enums
enum A { X, Y = 5, Z, W = "w", V = 1 << 3, U = V | Y, T = "a".length, S = -1, R = ~0, Q = Y * 2 + Z, P = `t${1}` as any, }
show("enum object", () => [Object.keys(A), Object.values(A)]);
enum Merge { A = 1 } enum Merge { B = A + 1, C = Merge.A + 10 }
show("merged enum", () => [Merge, Merge[2], Merge.C]);
const enum CE { A = 1, B = A << 4, C = "c" }
show("const enum", () => [CE.A, CE.B, CE.C, CE["B"]]);
enum Self { A = 1, B = Self.A + 1, C = Self["B"] * 3 }
show("self enum", () => Self);
let side = 0; function next() { return ++side; }
enum Computed { A = next(), B = next() * 10, C = "x".charCodeAt(0) }
show("computed enum", () => [Computed, side]);
enum Neg { A = -1, B, C } show("negative enum", () => [Neg, Neg[-1], Neg[0]]);
enum Fl { A = 0.5, B, C = 1e21, D = NaN, E = Infinity, F = -Infinity } show("float enum", () => [Object.keys(Fl), Fl.B, Fl[0.5], Fl[1e21], Fl[NaN], Fl["Infinity"], Fl["-Infinity"]]);
enum Dup { A = 1, B = 1, C = 2 } show("duplicate values", () => [Dup, Dup[1]]);
enum Names { toString = 1, constructor = 2, __proto__ = 3, length = 4, name = 5 } show("odd names", () => [Object.keys(Names), Names.toString, Names.constructor, Names[3], (Names as any).__proto__ === 3, Names.length]);
show("enum in enum scope", () => { const X = 100; enum In { X = 1, Y = X + 1 } return [In, X]; });
show("enum as value", () => { const e = A; const k: keyof typeof A = "Y"; return [e[k], e[e.Y], typeof e, Object.isFrozen(e)]; });
show("enum mutated", () => { (Dup as any).D = 9; (Dup as any).A = 7; const r = [Dup.A, (Dup as any).D, Dup[1]]; return r; });
// namespaces
namespace N { export const a = 1; export let b = 2; const hidden = 3; export function f() { return a + b + hidden; } export function setB(v: number) { b = v; } export class C { v = a; } export namespace Inner { export const deep = a + 10; } export enum E { P = 4 } }
show("namespace", () => [Object.keys(N), N.f(), (N.setB(20), N.b), N.f(), new N.C().v, N.Inner.deep, N.E.P]);
namespace N { export const later = a + b; export function g() { return f() + later; } }
show("merged namespace", () => [Object.keys(N), N.later, N.g()]);
show("namespace store from outside", () => { N.b = 100; return [N.b, N.f()]; });
function Fn() { return "fn"; } namespace Fn { export const extra = 5; export function helper() { return Fn() + extra; } }
show("function namespace", () => [Fn(), Fn.extra, Fn.helper(), Object.keys(Fn)]);
class Cl { static s = 1; m() { return Cl.extra; } } namespace Cl { export const extra = Cl.s + 1; }
show("class namespace", () => [Cl.extra, new Cl().m(), Object.keys(Cl)]);
enum En { A = 1 } namespace En { export function parse(s: string) { return En[s as keyof typeof En]; } }
show("enum namespace", () => [En.parse("A"), Object.keys(En)]);
namespace Empty { export type T = number; export interface I { x: T } } 
show("type-only namespace", () => typeof (globalThis as any).Empty);
namespace Dotted.Deep.Er { export const v = 1; } show("dotted namespace", () => Dotted);
namespace Shadow { export const x = 1; export function f(x: number) { return x; } export function g() { const x = 5; return x; } export function h() { return x; } }
show("shadowed export", () => [Shadow.f(9), Shadow.g(), Shadow.h()]);
namespace Destr { export const { p, q: [r, ...s] } = { p: 1, q: [2, 3, 4] }; export const [t = 7] = [] as number[]; } show("destructured exports", () => Destr);
namespace Alias { import I = N.Inner; export const v = I.deep; import fAlias = N.f; export const w = fAlias(); } show("import alias", () => Alias);
namespace Loop { export let i = 0; for (i = 0; i < 3; i++) {} export var j = i * 2; } show("namespace loop", () => Loop);
namespace Hoist { export const before = typeof later; export function later() {} } show("hoisted in namespace", () => Hoist);

// GENERATED: show next m C parse
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=JSON
// CHECK-NEXT: v8 = PropGet v7 key="stringify"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, v7, v10 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Call v6, v4, v0, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="threw"
// CHECK-NEXT: v21 = Convert v14 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = PropGet v21 key="constructor"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|function site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v24 = PropGet v23 key="name"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v26 = PropGet v21 key="message"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = Call v19, v17, v0, v20, v25, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="side"
// CHECK-NEXT: v2 = Increment v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="side"
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_8]]
// CHECK-NEXT: v7 = Convert v2 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="m"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_10]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Cl"
// CHECK-NEXT: v2 = PropGet v1 key="extra"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_12]]} illTypedCause=Assertion
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_14]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_15]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="parse"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|1|[[f_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v3 = Convert v0 declared={type=undefined|null|"A"|"parse" site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v4 = ElemGet v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|1|[[f_17]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
