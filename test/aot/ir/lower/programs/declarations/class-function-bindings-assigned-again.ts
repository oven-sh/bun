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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = Call v0 calleeName="h"
// CHECK-NEXT: ReturnCall v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="C"
// CHECK-NEXT: v2 = Construct v1 calleeName="C"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="D"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=ConstantAssignment name="g"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = PropGet v4 key="constructor"
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="L"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] captures=[{type=number variableName="i"}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: number, v1: anything):
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]]}
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_7]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pick"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=boolean}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = NewClosure function=[[f_8]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_9]]
// CHECK-NEXT: v3 = FinishClass v2 layout=[[L_9]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_8]] flags=[IsFromCompiler]}
// CHECK-NEXT: v5 = Convert v3 declared={type=[[f_8]] flags=[IsFromCompiler]}
// CHECK-NEXT: v6 = NewClosure function=[[f_10]]
// CHECK-NEXT: v7 = NewClass v6 layout=[[L_11]]
// CHECK-NEXT: v8 = FinishClass v7 layout=[[L_11]]
// CHECK-NEXT: v9 = Convert v8 declared={type=[[f_10]] flags=[IsFromCompiler]}
// CHECK-NEXT: v10 = Convert v8 declared={type=[[f_10]] flags=[IsFromCompiler]}
// CHECK-NEXT: v11 = ToBoolean v0
// CHECK-NEXT: Branch v11 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v12):
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Construct v14 calleeName="Z"
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
