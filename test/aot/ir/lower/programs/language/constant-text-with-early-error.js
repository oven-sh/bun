// RUN: lower
// OPTIONS: builtin-modules

// Constant text given to `Function` or `eval` that parses but has an early error (a jump without a target, a label declared twice, `super` outside a method, `delete` of a name in strict code) does not stop the build. The call stays an ordinary call and throws a SyntaxError each time it runs. The text beside it that has no error is compiled as usual.
function attempt(label, create) {
  for (let round = 0; round < 2; round++) {
    try {
      console.log(label + ":", typeof create());
    } catch (error) {
      console.log(label + ":", error.name);
    }
  }
}
function neverCalled() {
  return new Function("continue;");
}

attempt("break outside a loop", () => new Function("break"));
attempt("continue outside a loop", () => Function("continue;"));
attempt("break in a function inside a loop", () => new Function("for (;;) { (function () { break; }); }"));
attempt("break to a label that is not there", () => new Function("a: for (;;) { break b; }"));
attempt("a label declared twice", () => new Function("a: a: ;"));
attempt("super in a function body", () => new Function("super.x;"));
attempt("super in indirect eval", () => (0, eval)("super.x"));
attempt("delete of a name in strict code", () => new Function("'use strict'; delete a;"));

attempt("break inside a loop", () => new Function("for (;;) { break; }"));
attempt("continue to a label", () => new Function("a: for (;;) { continue a; }"));
attempt("delete of a name in sloppy code", () => new Function("delete a;"));
console.log(new Function("limit", "let count = 0; for (;;) { if (++count === limit) break; } return count;")(3));
console.log(typeof neverCalled);

// GENERATED: attempt neverCalled
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Less v4, v6
// CHECK-NEXT: Branch v7 -> taken b3(| 0), notTaken b10(| 0)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string=":"
// CHECK-NEXT: v15 = Add v0, v14
// CHECK-NEXT: v16 = Call v1 calleeName="create"
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = Call v13, v11, v15, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b7() role=CatchHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = String string=":"
// CHECK-NEXT: v26 = Add v0, v25
// CHECK-NEXT: v27 = PropGet v19 key="name"
// CHECK-NEXT: v28 = Call v24, v22, v26, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v29 = Increment v8
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v30)
// CHECK-NEXT: b10(v31):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverCalled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|function flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Function" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="continue;"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="Function"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=undefined|null|function flags=[IsExpected]}}]
// CHECK-NEXT: }
