// RUN: lower
// OPTIONS: builtin-modules

// eval is called inside a function, an arrow function, a method, a default value, a static block and a nested function. Each text names a function of the module that nothing else names.
function a() { return "from a function"; } function b() { return "from an arrow function"; } function c() { return "from a method"; }
function d() { return "from a default value"; } function e() { return "from a static block"; } function f() { return "from a nested function"; }
function g() { return "from a parenthesized eval"; } function h() { return "from a spread argument"; } function i() { return "from an optional call"; }

function inFunction() { return eval("a()"); }
const inArrow = () => eval("b()");
class Holder {
  static fromBlock: string;
  static { Holder.fromBlock = eval("e()"); }
  method() { return eval("c()"); }
}
function inDefault(value = eval("d()")) { return value; }
function outer() {
  return (function () { return (() => eval("f()"))(); })();
}
console.log(inFunction(), inArrow(), new Holder().method(), inDefault(), Holder.fromBlock, outer());
console.log((eval)("g()"), eval(...["h()"]));

// GENERATED: inFunction inDefault Holder method
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="eval" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="a()"
// CHECK-NEXT: v9 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v10 = StrictEq v7, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = DirectEval v8, v0, v1, v4 evalScope=e2
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = Call v12, -, v8 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inDefault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: anything, v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateUnmappedArguments v2, v4, v3
// CHECK-NEXT: v6 = NewObject layout=[[L_3]]
// CHECK-NEXT: v7 = TypeTest v3 testedType=undefined
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="eval" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v12 = String string="d()"
// CHECK-NEXT: v13 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v14 = StrictEq v11, v13
// CHECK-NEXT: Branch v14 -> taken b4(), notTaken b5(| 0)
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = DirectEval v12, v0, v1, v6, v5 evalScope=e3
// CHECK-NEXT: Jump -> next b6(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: v17 = Call v16, -, v12 calleeName="eval"
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: Jump -> next b8(v18)
// CHECK-NEXT: b7(v19):
// CHECK-NEXT: Jump -> next b8(v19)
// CHECK-NEXT: b8(v20):
// CHECK-NEXT: PutEnvironmentField v6, v20 layout=[[L_3]]
// CHECK-NEXT: v22 = GetEnvironmentField v6 layout=[[L_3]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="value"
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=[[L_5]] site=[[w_6]]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: int[0, 4294967295], v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = CreateUnmappedArguments v1, v2
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="eval" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="c()"
// CHECK-NEXT: v8 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v9 = StrictEq v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v12 = PropGet v11 key="prototype"
// CHECK-NEXT: v13 = DirectEval v7, v0, v10, v3, v12 evalScope=e5
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: v15 = Call v14, -, v7 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
