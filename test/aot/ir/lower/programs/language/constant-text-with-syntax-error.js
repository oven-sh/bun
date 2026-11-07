// RUN: lower
// OPTIONS: builtin-modules

// Constant text given to `Function` or `eval` that does not parse, or that has an early error, does not stop the build: the call stays an ordinary call and throws its SyntaxError when it runs, and only then.
function attempt(label, f) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", e.name); }
}
function neverCalled() { return new Function("return (")(); }

attempt("new Function, a body that does not parse", () => new Function("return ("));
attempt("Function without new", () => Function("a b c"));
attempt("parameters that do not parse", () => new Function("a b", "return a"));
attempt("a name declared twice", () => new Function("let a; let a;"));
attempt("break outside a loop", () => new Function("break;"));
attempt("indirect eval", () => (0, eval)("1 +"));
attempt("direct eval", () => eval("var ;"));
attempt("direct eval, a name declared twice", () => eval("let b; let b;"));
attempt("new Function, a body that parses", () => new Function("return 1 + 1")());
attempt("direct eval of text that parses", () => eval("1 + 1"));
attempt("a function that holds such a call and is never called", () => typeof neverCalled);
if (process.argv.length > 100) eval(") (");
console.log("the end is reached");

// GENERATED: attempt neverCalled
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v1 calleeName="f"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v6, v4, v8, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=":"
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = PropGet v14 key="name"
// CHECK-NEXT: v23 = Call v19, v17, v21, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="neverCalled"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Function" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="return ("
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Function"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
