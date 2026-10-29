// RUN: lower
// OPTIONS: builtin-modules

// node:child_process creates its errors from the realm's own TypeError, not from a class that the program stores in `globalThis.TypeError` before it requires the module.
const RealTypeError = TypeError;
globalThis.TypeError = class Fake extends Error {};
const childProcess = require("node:child_process");

function attempt(label, run) {
  try {
    run();
    console.log(label, "returns");
  } catch (error) {
    console.log(label, error.constructor.name, error.constructor === RealTypeError, error instanceof TypeError, error.name, error.code, error.message);
  }
}

attempt("spawn", () => childProcess.spawn("ls", [], { killSignal: "SIGNOPE" }));
attempt("spawnSync", () => childProcess.spawnSync("ls", [], { killSignal: "SIGNOPE" }));
attempt("execFile", () => childProcess.execFile("ls", [], { killSignal: "SIGNOPE" }));
attempt("the program's own", () => {
  const Replaced = globalThis.TypeError;
  throw new Replaced("from the program");
});

// GENERATED: attempt Fake
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v3 = Call v2 calleeName="run"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="returns"
// CHECK-NEXT: v10 = Call v8, v6, v1, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v11 key="constructor"
// CHECK-NEXT: v18 = PropGet v17 key="name"
// CHECK-NEXT: v19 = PropGet v11 key="constructor"
// CHECK-NEXT: v20 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="RealTypeError"
// CHECK-NEXT: v22 = StrictEq v19, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="TypeError" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v11, v25 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v27 = PropGet v11 key="name"
// CHECK-NEXT: v28 = PropGet v11 key="code"
// CHECK-NEXT: v29 = PropGet v11 key="message"
// CHECK-NEXT: v30 = Call v16, v14, v1, v18, v22, v26, v27, v28, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Fake"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
