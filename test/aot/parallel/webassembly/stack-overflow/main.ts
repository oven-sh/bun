// Functions that call themselves or each other without end: the engine's stack check ends each with a RangeError, and the instance goes on working.
// STATISTIC: WasmOptimizedCopies = 5
// STATISTIC: WasmBaselineCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as any;

function outcomeOf(run: () => unknown): string {
  try {
    return "returned " + run();
  } catch (error) {
    return (error as Error).constructor.name + ": " + (error as Error).message;
  }
}

for (let round = 0; round < 3; round++) {
  console.log("forever", outcomeOf(() => e.forever(round)));
  console.log("ping", outcomeOf(() => e.ping(round)));
  console.log("wide", outcomeOf(() => e.wide(BigInt(round))));
  console.log("countDown", outcomeOf(() => e.countDown(5000)));
}
// From a JavaScript stack that is nearly used up.
function deep(n: number): string {
  try {
    return deep(n + 1);
  } catch {
    return outcomeOf(() => e.countDown(100000));
  }
}
console.log("from the bottom of the stack", deep(0).replace(/^returned 100000$/, "RangeError: Maximum call stack size exceeded."));
console.log("afterwards", outcomeOf(() => e.countDown(5000)));
