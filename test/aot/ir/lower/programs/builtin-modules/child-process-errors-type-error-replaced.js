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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Call v1 calleeName="run"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="returns"
// CHECK-NEXT: v9 = Call v7, v5, v0, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="console" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="log"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v10 key="constructor"
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: v18 = PropGet v10 key="constructor"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="RealTypeError"
// CHECK-NEXT: v21 = StrictEq v18, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="TypeError" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v10, v24
// CHECK-NEXT: v26 = PropGet v10 key="name"
// CHECK-NEXT: v27 = PropGet v10 key="code"
// CHECK-NEXT: v28 = PropGet v10 key="message"
// CHECK-NEXT: v29 = Call v15, v13, v0, v17, v21, v25, v26, v27, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Fake"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
