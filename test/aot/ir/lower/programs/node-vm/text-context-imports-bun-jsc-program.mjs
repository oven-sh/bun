// RUN: lower
// OPTIONS: builtin-modules

// A text that runs in a context of node:vm imports bun:jsc, which the program imports too, through a loader that is a function and through the loader of the main context.
import * as named from "bun:jsc";
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
console.log(typeof named);
const text = "import('bun:jsc')";
for (const [loader, importModuleDynamically] of [
  ["a function", specifier => import(specifier)],
  ["the main loader", vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER],
]) {
  const options = { importModuleDynamically };
  for (const [way, run] of [
    ["runInNewContext", () => vm.runInNewContext(text, {}, options)],
    ["runInContext", () => vm.runInContext(text, vm.createContext({}), options)],
    ["a Script", () => new vm.Script(text, options).runInNewContext({})],
  ]) {
    await show(`${way}, ${loader}:`, async () => {
      const found = await run();
      return typeof found.heapStats;
    });
  }
}

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=JSON
// CHECK-NEXT: v9 = PropGet v8 key="stringify"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v2 calleeName="run"
// CHECK-NEXT: v12 = Await v11, v1, v2
// CHECK-NEXT: v13 = Call v10, v8, v12 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v7, v5, v1, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="threw"
// CHECK-NEXT: v23 = TypeTest v16 testedType=undefined|null
// CHECK-NEXT: Branch v23 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: Jump -> next b8(v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = PropGet v25 key="constructor"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v28 = TypeTest v27 testedType=undefined|null
// CHECK-NEXT: Branch v28 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: Jump -> next b8(v25)
// CHECK-NEXT: b8(v30):
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Jump -> next b10(v31, v30)
// CHECK-NEXT: b9(v32):
// CHECK-NEXT: v33 = PropGet v32 key="name"
// CHECK-NEXT: Jump -> next b10(v33, v25)
// CHECK-NEXT: b10(v34, v35):
// CHECK-NEXT: v36 = Convert v34 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v37 = TypeTest v35 testedType=undefined|null
// CHECK-NEXT: Branch v37 -> taken b11(| 0), notTaken b13(| 0)
// CHECK-NEXT: b11(v38):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Jump -> next b14(v39)
// CHECK-NEXT: b13(v40):
// CHECK-NEXT: v41 = PropGet v40 key="code"
// CHECK-NEXT: Jump -> next b14(v41)
// CHECK-NEXT: b14(v42):
// CHECK-NEXT: v43 = Call v21, v19, v1, v22, v36, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
