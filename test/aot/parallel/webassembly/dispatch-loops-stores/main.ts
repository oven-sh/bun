// State machines written as a loop around a br_table on a local: which store selects the next state, and what may stand between the store and the branch.
// STATISTIC: WasmOptimizedCopies = 4
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// STATISTIC: WasmJumpsThreaded = 19
// STATISTIC: WasmFirstStateTests = 2
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 1
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as any;
const states = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 100, -1, 2147483647, -2147483648];

for (const name of ["overwritten", "between", "sameLocal"]) {
  for (let n = 0; n < 8; n++) console.log(name, n, states.map(state => e[name](state, n)).join());
}
