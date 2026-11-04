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
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v3)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = Integer integer=2
// CHECK-NEXT: v7 = Less v4, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b6()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b4():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = String string=":"
// CHECK-NEXT: v14 = Add v0, v13
// CHECK-NEXT: v15 = Call v1 calleeName="create"
// CHECK-NEXT: v16 = TypeOf v15
// CHECK-NEXT: v17 = Call v12, v10, v14, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v18 = CatchValue
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = String string=":"
// CHECK-NEXT: v25 = Add v0, v24
// CHECK-NEXT: v26 = PropGet v18 key="name"
// CHECK-NEXT: v27 = Call v23, v21, v25, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v28 = Increment v4
// CHECK-NEXT: v29 = Convert v28 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v29)
// CHECK-NEXT: b6():
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverCalled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Function" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="continue;"
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Function"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
