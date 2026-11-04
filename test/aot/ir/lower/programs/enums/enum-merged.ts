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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = Convert v5 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twoActivations"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer
// CHECK-NEXT: v1 = String string="A"
// CHECK-NEXT: v2 = NewObject -, v0 layout=[[L_2]] fields=[0]
// CHECK-NEXT: ElemDefine v2, v0, v1
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: Jump -> next b3(v2, v0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: v4 = NewObject layout=[[L_3]]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Jump -> next b3(v5, v5)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: PropSet v6, v8 key="A"
// CHECK-NEXT: v10 = String string="A"
// CHECK-NEXT: ElemSet v6, v8, v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="keys"
// CHECK-NEXT: v14 = Call v13, -, v7 calleeName="keys"
// CHECK-NEXT: v15 = ToBoolean v7
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Jump -> next b6(v16, v7)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = NewObject layout=[[L_3]]
// CHECK-NEXT: v19 = FinishObject v18
// CHECK-NEXT: Jump -> next b6(v19, v19)
// CHECK-NEXT: b6(v20, v21):
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: PropSet v20, v22 key="B"
// CHECK-NEXT: v24 = String string="B"
// CHECK-NEXT: ElemSet v20, v22, v24
// CHECK-NEXT: v26 = StrictEq v7, v21
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="keys"
// CHECK-NEXT: v29 = Call v28, -, v21 calleeName="keys"
// CHECK-NEXT: v30 = NewArray v26, v14, v29 contents=anything
// CHECK-NEXT: v31 = PropGet v30 key="join"
// CHECK-NEXT: v32 = String string=" "
// CHECK-NEXT: v33 = Call v31, v30, v32 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v33 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keys"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
