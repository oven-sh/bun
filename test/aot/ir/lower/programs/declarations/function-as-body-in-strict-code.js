// RUN: lower
// OPTIONS: builtin-modules

// A plain function declaration as the body of a label or of `if`, in strict code. ECMAScript rejects it there. Plain Bun runs it: its transpiler turns the function into a `let` in a block of its own. So the program builds, the name ends with the statement, and a binding of the same name around it is left alone. This CommonJS file is strict only inside the class.
module.exports = {};
function row(label, f) { let said; try { said = String(f()); } catch (e) { said = "threw " + e.name; } console.log(label + ": " + said); }
class Strict {
  static mode() { return (function () { return this === undefined ? "strict" : "sloppy"; })(); }
  static labeled() { const before = typeof inner; again: function inner() { return 1; } return before + " " + typeof inner; }
  static twoLabels() { outer: again: function inner() { return 1; } return typeof inner; }
  static labeledInBlock() { { again: function inner() { return 1; } } return typeof inner; }
  static underIf(flag) { if (flag) function inner() { return 1; } return typeof inner; }
  static underElse(flag) { if (flag) ; else function inner() { return 1; } return typeof inner; }
  static besideConst() { const inner = "const"; again: function inner() { return 1; } return inner; }
  static besideParameter(inner) { if (inner) function inner() { return 1; } return inner; }
}
row("control: which mode the file is in", () => (function () { return this === undefined ? "strict" : "sloppy"; })());
row("control: which mode the class is in", () => Strict.mode());
row("under a label", () => Strict.labeled());
row("under two labels", () => Strict.twoLabels());
row("under a label in a block", () => Strict.labeledInBlock());
row("under if, taken", () => Strict.underIf(true));
row("under if, not taken", () => Strict.underIf(false));
row("under else, taken", () => Strict.underElse(false));
row("under else, not taken", () => Strict.underElse(true));
row("under a label, beside a const of the name", () => Strict.besideConst());
row("under if, beside a parameter of the name", () => Strict.besideParameter("parameter"));

// GENERATED: row Strict mode underIf
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Builtin builtin=String
// CHECK-NEXT: v5 = Call v1 calleeName="f"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = PropGet v8 key="name"
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v12)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="console" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="log"
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string=": "
// CHECK-NEXT: v20 = Add v0, v19
// CHECK-NEXT: v21 = Add v20, v13
// CHECK-NEXT: v22 = Call v18, v16, v21 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Strict"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mode"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"sloppy"|"strict" flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_3]]
// CHECK-NEXT: v1 = Call v0
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|"sloppy"|"strict" flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="underIf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = NewClosure function=[[f_5]]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="inner" [isFreeName, isForTypeOf]
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
