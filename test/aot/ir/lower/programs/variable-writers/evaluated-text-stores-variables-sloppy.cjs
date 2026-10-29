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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: anything, v8: undefined|null|string, v9: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v10 = CreateMappedArguments v4, v6, v9, v7, v8
// CHECK-NEXT: v11 = ToThis v3
// CHECK-NEXT: v12 = NewObject layout=[[L_3]]
// CHECK-NEXT: v13 = Null
// CHECK-NEXT: SetLiteralPrototype v12, v13
// CHECK-NEXT: v15 = FinishObject v12
// CHECK-NEXT: v16 = NewObject -, v10 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v17 = ScopeHasBinding v15 key="eval"
// CHECK-NEXT: Branch v17 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b6(v15, v18)
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v19 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b6(v2, v20)
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Jump -> next b6(v21, v21)
// CHECK-NEXT: b6(v22, v23):
// CHECK-NEXT: v24 = TypeTest v22 testedType=object
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = PropGet v25 key="eval"
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b8(v27):
// CHECK-NEXT: v28 = Builtin builtin=GlobalThis
// CHECK-NEXT: v29 = PropGet v28 key="eval" [isFreeName]
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v30)
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: v32 = GetMappedArgument v10 index=1
// CHECK-NEXT: v33 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v34 = StrictEq v31, v33
// CHECK-NEXT: Branch v34 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v35 = DirectEval v32, v11, v5, v10, v0, v15, v16, v2, v1 evalScope=e5
// CHECK-NEXT: Jump -> next b12(v35)
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: v37 = Call v36, v23, v32 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v37)
// CHECK-NEXT: b12(v38):
// CHECK-NEXT: v39 = GetMappedArgument v10
// CHECK-NEXT: v40 = TypeOf v39
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="h"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}, {type=undefined|null|string flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: undefined|null|function, v8: undefined|null|string, v9: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v10 = CreateMappedArguments v4, v6, v9, v7, v8
// CHECK-NEXT: v11 = ToThis v3
// CHECK-NEXT: v12 = NewObject layout=[[L_3]]
// CHECK-NEXT: v13 = Null
// CHECK-NEXT: SetLiteralPrototype v12, v13
// CHECK-NEXT: v15 = FinishObject v12
// CHECK-NEXT: v16 = NewObject -, v10 layout=[[L_6]] fields=[1]
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v16, v18 layout=[[L_6]]
// CHECK-NEXT: v20 = GetMappedArgument v10
// CHECK-NEXT: v21 = GetMappedArgument v10 index=1
// CHECK-NEXT: v22 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v23 = StrictEq v20, v22
// CHECK-NEXT: Branch v23 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v24 = DirectEval v21, v11, v5, v10, v16, v0, v15, v2, v1 evalScope=e7
// CHECK-NEXT: Jump -> next b4(v24)
// CHECK-NEXT: b3(v25):
// CHECK-NEXT: v26 = Call v25, -, v21 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v26)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: v28 = GetEnvironmentField v16 layout=[[L_6]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="x"
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=env [[L_7]] flags=[IsFromCompiler]}, {type=env [[L_8]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: env [[L_7]], v2: env [[L_8]], v3: object, v4: object, v5: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = GetConstructPrototype v5 layout=[[L_9]]
// CHECK-NEXT: v7 = NewObject v6 layout=[[L_9]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = CallDirect v0, v1, v2, v3, v4, v8 function=[[f_10]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
