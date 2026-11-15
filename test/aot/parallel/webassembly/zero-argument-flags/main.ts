// Functions that test their first parameter twice and reuse the flags of the first test on the path for zero, called directly with the constant zero by code that has set other flags.
// STATISTIC: WasmOptimizedCopies = 48
// STATISTIC: WasmDirectEntries = 48
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const { memory, ...callers } = new WebAssembly.Instance(module).exports as Record<string, any>;
const operands = [
  [7, 100, 3, 4],
  [-7, 3, 200, -1],
  [0, 0, 0, 0],
  [5, 1, -2147483648, 99],
  [200, 12, 1, 100],
];
for (const [name, call] of Object.entries(callers)) console.log(name, operands.map(values => call(...values)).join(" "));
