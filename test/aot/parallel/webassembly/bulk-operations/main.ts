// What fills, copies and initializes memories and tables at once, references to functions and to values of JavaScript, and calls through a reference.
// STATISTIC: WasmOptimizedCopies = 17
// STATISTIC: WasmBaselineCopies = 22
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 19
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 1
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}
async function moduleAt(path: string) {
  return new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

const e = new WebAssembly.Instance(await moduleAt(path)).exports as any;
const bytes = new Uint8Array(e.memory.buffer);
const text = (at: number, length: number) => String.fromCharCode(...bytes.slice(at, at + length));
e.fill(0, 65, 4);
e.init(4, 0, 9);
e.copy(2, 4, 5);
console.log("memory", JSON.stringify(text(0, 13)), outcomeOf(() => e.init(0, 5, 5)), outcomeOf(() => e.fill(65535, 0, 2)), outcomeOf(() => e.copy(0, 65530, 7)));
e.dropData();
console.log("dropped", outcomeOf(() => e.init(0, 0, 1)), outcomeOf(() => e.init(0, 0, 0)));
console.log("empty", [0, 1, 2, 3].map(i => e.isEmpty(i)).join(), outcomeOf(() => e.call(0, 5)), outcomeOf(() => e.isEmpty(4)));
e.tableInit(1, 0, 2);
console.log("tableInit", e.call(1, 5), e.call(2, 5), outcomeOf(() => e.tableInit(3, 0, 2)));
e.tableCopy(0, 1, 2);
console.log("tableCopy", e.call(0, 6), e.call(1, 6), e.call(2, 6));
console.log("tableGrow", e.tableSize(), e.tableGrow(3), e.tableSize(), e.call(6, 4), e.tableGrow(2), e.tableSize());
e.tableFill(0, 2);
console.log("tableFill", [0, 1, 2, 3, 4].map(i => e.isEmpty(i)).join(), outcomeOf(() => e.tableFill(6, 2)));
e.dropElements();
console.log("dropElements", outcomeOf(() => e.tableInit(0, 0, 1)));
const object = { name: "kept" };
e.keep(1, object);
console.log("externref", e.kept(0), e.kept(1) === object, outcomeOf(() => e.kept(2)), outcomeOf(() => e.keep(2, 1)));
console.log("callRef", e.callRef(5), e.tailCallRef(6), e.callGiven(e.callRef, 7), outcomeOf(() => e.callGiven(null, 1)));
e.table.set(0, e.callRef);
console.log("set from outside", e.call(0, 8));
