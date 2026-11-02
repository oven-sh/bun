// RUN: lower
// OPTIONS: builtin-modules

// An enum declared in three parts is one object that gains members as each part runs.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown) { console.log(label + ": " + said(f)); }
const keys = (o: object) => Object.keys(o).join();

enum E { A }
const first = E;
row("keys behind the first", () => keys(E));
row("the later member is not there yet", () => "B" in E);
(E as any).mark = 7;
enum E { B = 1 }
row("one object", () => first === E);
row("the mark stays", () => (E as any).mark);
row("keys behind the second", () => keys(E));
enum E { C = "c" }
row("one object still", () => first === E);
row("keys behind the third", () => keys(E));
row("the reverse mapping", () => E[0] + E[1] + String((E as any)["c"]));
enum Never { A } enum Never { B = 1 }
row("control: merged and only read as members", () => Never.A + Never.B);
enum Late { A } enum Late { B = 1 }
row("control: asked for behind both", () => keys(Late));
function inFunction() { enum F { A } const f = F; const k = keys(F); enum F { B = 1 } return [f === F, k, keys(F)].join(" "); }
row("in a function", inFunction);
row("in a function, again", inFunction);
function twoActivations() { enum G { A } return G; }
row("two activations", () => twoActivations() === twoActivations());
namespace N { export enum H { A } export const h = H; export const k = keys(H); export enum H { B = 1 } }
row("in a namespace", () => [N.h === N.H, N.k, keys(N.H)].join(" "));
namespace M { export enum I { A } } namespace M { export enum I { B = 1 } }
row("in two blocks of a namespace", () => keys(M.I));
enum Uses { A = 1 } enum Uses { B = A + 1 }
row("a member of the first in the second", () => keys(Uses) + " " + Uses.B);
enum One { A, B }
const one = One;
row("control: one declaration", () => [one === One, keys(One)].join(" "));

// GENERATED: said twoActivations inFunction keys
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Add v6, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twoActivations"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|object site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = String string="A"
// CHECK-NEXT: v2 = NewObject -, v0 layout=[[L_7]] fields=[0]
// CHECK-NEXT: ElemDefine v2, v0, v1
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b4(v2, v0)
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_10]]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Jump -> next b4(v5, v5)
// CHECK-NEXT: b4(v6, v7):
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: PropSet v6, v8 key="A"
// CHECK-NEXT: v10 = String string="A"
// CHECK-NEXT: ElemSet v6, v8, v10
// CHECK-NEXT: v12 = Convert v7 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="keys"
// CHECK-NEXT: v15 = Call v14, -, v12 calleeName="keys"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v17 = ToBoolean v12
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b7(v18, v12)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = NewObject layout=[[L_10]]
// CHECK-NEXT: v21 = FinishObject v20
// CHECK-NEXT: Jump -> next b7(v21, v21)
// CHECK-NEXT: b7(v22, v23):
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: PropSet v22, v24 key="B"
// CHECK-NEXT: v26 = String string="B"
// CHECK-NEXT: ElemSet v22, v24, v26
// CHECK-NEXT: v28 = Convert v23 declared={type=undefined|null|object} illTypedCause=Assertion
// CHECK-NEXT: v29 = StrictEq v12, v28
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="keys"
// CHECK-NEXT: v32 = Call v31, -, v28 calleeName="keys"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v34 = NewArray v29, v16, v33 contents=undefined|null|boolean|string
// CHECK-NEXT: v35 = PropGet v34 key="join"
// CHECK-NEXT: v36 = String string=" "
// CHECK-NEXT: v37 = Call v35, v34, v36 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v37 casts=[{declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
