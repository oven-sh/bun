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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
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
// CHECK-NEXT: v14 = Call v7, v5, v1, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="threw"
// CHECK-NEXT: v22 = TypeTest v15 testedType=undefined|null
// CHECK-NEXT: Branch v22 -> taken b4(), notTaken b3(| 0)
// CHECK-NEXT: b3(v23):
// CHECK-NEXT: v24 = PropGet v23 key="constructor"
// CHECK-NEXT: v25 = TypeTest v24 testedType=undefined|null
// CHECK-NEXT: Branch v25 -> taken b4(), notTaken b5(| 0)
// CHECK-NEXT: b4():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Jump -> next b6(v26)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: v28 = PropGet v27 key="name"
// CHECK-NEXT: Jump -> next b6(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: v30 = TypeTest v15 testedType=undefined|null
// CHECK-NEXT: Branch v30 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v31):
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Jump -> next b9(v32)
// CHECK-NEXT: b8(v33):
// CHECK-NEXT: v34 = PropGet v33 key="code"
// CHECK-NEXT: Jump -> next b9(v34)
// CHECK-NEXT: b9(v35):
// CHECK-NEXT: v36 = Call v20, v18, v1, v21, v29, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
