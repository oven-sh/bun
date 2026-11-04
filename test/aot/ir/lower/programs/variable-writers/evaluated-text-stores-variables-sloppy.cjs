// RUN: lower
// OPTIONS: builtin-modules

// Text handed to a direct eval assigns, declares and hides the variables, parameters and functions around the call.
function a() { let x = 1; const g = () => x; eval("x = 2"); return g(); }
function b(s) { let x = 1; const g = () => x; eval(s); return g(); }
function c(s) { var x = 1; eval(s); return x; }
function d(s) { let x = 1; function inner() { return eval(s); } inner(); return x; }
function e(s) { let x = 1; const inner = () => eval(s); inner(); return x; }
function f(x, s) { eval(s); return typeof x; }
function g(s) { const r = []; for (let i = 0; i < 3; i++) { r.push(() => i); eval(s); } return r.map(h => h()); }
function h(eval, s) { let x = 1; eval(s); return x; }
function i(s) { let x = 1; (eval)(s); return x; }
function j(s) { let x = 1; try { (0, eval)(s); } catch (e) { return [x, e.name]; } return [x, typeof globalThis.x]; }
function k(s) { let x = 1; with ({ eval }) { eval(s); } return x; }
function l(s) { let x = 1; try { throw 5; } catch (err) { eval(s); return [x, err]; } }
function m(s, y = eval(s)) { return [typeof x, y]; }
function n(s) { let x = 1; class C { f = eval(s); } new C(); return x; }
function o(s) { let x = 1; const gen = (function* () { yield eval(s); yield x; })(); gen.next(); return gen.next().value; }
async function p(s) { let x = 1; await null; eval(s); await null; return x; }
function q(s) { let x = 1; const e2 = eval; e2("var zz = 1"); eval?.(s.replace("x", "globalThis.yy")); return [x, globalThis.yy]; }
console.log(a(), b("x = 3"), c("var x = 4"), d("x = 5"), e("x = 6"), f(1, "function x() {}"), f(1, "var x = 'a'"));
console.log(JSON.stringify(g("i++")), h(eval, "x = 7"), h(s => 0, "x = 7"), i("x = 8"), JSON.stringify(j("x = 9")), k("x = 10"), JSON.stringify(l("x = 11; err = 12")));
console.log(JSON.stringify(m("var x = 1; 13")), n("x = 14"), o("x = 15"), JSON.stringify(q("x = 16")));
p("x = 17").then(v => console.log(v));
let top = 1; function readTop() { return top; } eval("top = 2"); console.log(readTop());
function viaTop(s) { eval(s); } viaTop("top = 3"); console.log(readTop());
function declared() { return 1; } function callDeclared() { return declared(); } eval("declared = function () { return 2; }"); console.log(callDeclared());
function shadow(s) { eval(s); return top; } console.log(shadow("var top = 'shadow'"), top);
function shadowFn(s) { eval(s); return declared(); } console.log(shadowFn("function declared() { return 'inner'; }"), declared());

// GENERATED: f h C
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: anything, v7: undefined|null|string, v8: Array):
// CHECK-NEXT: v9 = CreateMappedArguments v3, v5, v8, v6, v7
// CHECK-NEXT: v10 = ToThis v2
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v16 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b5(v14, v17)
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = ScopeHasBinding v1 key="eval"
// CHECK-NEXT: Branch v18 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b5(v1, v19)
// CHECK-NEXT: b4():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b5(v20, v20)
// CHECK-NEXT: b5(v21, v22):
// CHECK-NEXT: v23 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v23 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = PropGet v24 key="eval"
// CHECK-NEXT: Jump -> next b8(v25)
// CHECK-NEXT: b7(v26):
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="eval" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v29)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = GetMappedArgument v9 index=1
// CHECK-NEXT: v32 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v33 = StrictEq v30, v32
// CHECK-NEXT: Branch v33 -> taken b9(), notTaken b10(| 0)
// CHECK-NEXT: b9():
// CHECK-NEXT: v34 = DirectEval v31, v10, v4, v9, v14, v15, v1, v0 evalScope=e5
// CHECK-NEXT: Jump -> next b11(v34)
// CHECK-NEXT: b10(v35):
// CHECK-NEXT: v36 = Call v35, v22, v31 calleeName="eval"
// CHECK-NEXT: Jump -> next b11(v36)
// CHECK-NEXT: b11(v37):
// CHECK-NEXT: v38 = GetMappedArgument v9
// CHECK-NEXT: v39 = TypeOf v38
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: undefined|null|function, v7: undefined|null|string, v8: Array):
// CHECK-NEXT: v9 = CreateMappedArguments v3, v5, v8, v6, v7
// CHECK-NEXT: v10 = ToThis v2
// CHECK-NEXT: v11 = NewObject layout=[[L_1]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_3]] fields=[1]
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Convert v16 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v15, v17 layout=[[L_3]]
// CHECK-NEXT: v19 = GetMappedArgument v9
// CHECK-NEXT: v20 = GetMappedArgument v9 index=1
// CHECK-NEXT: v21 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v22 = StrictEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v23 = DirectEval v20, v10, v4, v9, v15, v14, v1, v0 evalScope=e7
// CHECK-NEXT: Jump -> next b3(v23)
// CHECK-NEXT: b2(v24):
// CHECK-NEXT: v25 = Call v24, -, v20 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v25)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: v27 = GetEnvironmentField v15 layout=[[L_3]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="x"
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}, {type=env [[L_5]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: env [[L_5]], v2: object, v3: object, v4: anything):
// CHECK-NEXT: v5 = GetConstructPrototype v4 layout=[[L_6]]
// CHECK-NEXT: v6 = NewObject v5 layout=[[L_6]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_6]]}
// CHECK-NEXT: v8 = CallDirect v0, v1, v2, v3, v7 function=[[f_7]]
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
