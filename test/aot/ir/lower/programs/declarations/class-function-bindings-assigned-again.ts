// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// Bindings of class and function declarations are assigned again, here and in the module that exports them, and every user sees the new value; the inner binding of a class stays.
import Def, { Ex, fn, live, swap, inside } from "./exporter";
import * as ns from "./exporter";
function show(label: string, f: () => unknown) {
    try { console.log(label, JSON.stringify(f())); } catch (e) { console.log(label, "threw", (e as Error).constructor.name, (e as Error).message); }
}
class A { m() { return "A"; } static s = 1; x = "ax"; }
class B { m() { return "B"; } static s = 2; y = "by"; }
function useA() { return [new A().m(), A.s, A.name, Object.keys(new A()).join()]; }
show("class before", useA);
// @ts-ignore
A = B;
show("class reassigned", useA);
show("instanceof after", () => [new A() instanceof B, new B() instanceof A]);
class C { static make() { return new C(); } who() { return "C"; } }
const keepC = C;
// @ts-ignore
C = class { who() { return "replaced"; } };
show("inner binding stays", () => [keepC.make().who(), new C().who()]);
class D extends A { }
show("extends reassigned", () => [new D().m(), Object.getPrototypeOf(D) === B]);
show("const inner binding", () => { class E { static f() { /* @ts-ignore */ (E as any) = 1; } } try { E.f(); } catch (e) { return (e as Error).constructor.name; } return "no throw"; });
show("class expression name", () => { const F = class G { static f() { /* @ts-ignore */ (G as any) = 1; } }; try { F.f(); } catch (e) { return (e as Error).constructor.name; } return "no throw"; });
show("function expression name", () => { const f = function g() { try { /* @ts-ignore */ (g as any) = 1; } catch (e) { return (e as Error).constructor.name; } return typeof g; }; return f(); });
function h() { return 1; }
function callH() { return h(); }
show("function before", callH);
// @ts-ignore
h = () => 2;
show("function reassigned", callH);
show("imports before", () => [new Ex().m(), Ex.s, fn(), new Def().m(), live, inside(), new ns.Ex().m(), ns.fn(), ns.live]);
swap();
show("imports after", () => [new Ex().m(), Ex.s, fn(), new Def().m(), live, inside(), new ns.Ex().m(), ns.fn(), ns.live, new ns.default().m()]);
let K = class { v = 1; }; const k1 = new K(); K = class { v = 2; w = 3; } as any; show("let class", () => [k1, new K()]);
var V = class { v = 1; }; function mkV() { return new V(); } show("var class", () => { const a = mkV(); V = class { v = 5; } as any; return [a, mkV()]; });
show("class in loop", () => { const made: any[] = []; for (let i = 0; i < 3; i++) { class L { static n = i; i = i; } made.push(L); } return [made.map(m => m.n), made[0] === made[1], new made[2]().i, new made[0]() instanceof made[1]]; });
show("conditional class", () => { const pick = (c: boolean) => { class X { t = "x"; } class Y { t = "y"; u = 1; } let Z: any = X; if (c) Z = Y; return new Z(); }; return [pick(true), pick(false)]; });

// FILE: exporter.ts
export class Ex { m() { return "Ex"; } static s = "Ex.s"; }
export function fn() { return "fn"; }
export default class Def { m() { return "Def"; } }
export let live = 1;
class Other { m() { return "Other"; } static s = "Other.s"; }
export function swap() {
    // @ts-ignore
    Ex = Other;
    // @ts-ignore
    fn = () => "fn2";
    // @ts-ignore
    Def = Other;
    live = 2;
}
export function inside() { return [new Ex().m(), Ex.s, fn(), new Def().m(), live].join(); }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: callH make D g L pick
// CHECK-LABEL: function {{*}}name="callH"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v2 = Call v1 calleeName="h"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_1]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="C"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_9]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Construct v2 calleeName="C"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_6]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=ConstantAssignment name="g"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="constructor"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|function site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="name"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_15]]} illTypedCause=Assertion
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="L"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=number site=[[w_16]]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: number, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_17]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_17]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_18]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=boolean site=[[w_19]]}] results=[{type=anything}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure function=[[f_21]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_22]]
// CHECK-NEXT: v3 = FinishClass v2 layout=[[L_22]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v3 declared={type=[[f_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = NewClosure function=[[f_23]]
// CHECK-NEXT: v7 = NewClass v6 layout=[[L_24]]
// CHECK-NEXT: v8 = FinishClass v7 layout=[[L_24]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_23]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Convert v8 declared={type=[[f_23]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = ToBoolean v0
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v16 = Construct v15 calleeName="Z"
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
