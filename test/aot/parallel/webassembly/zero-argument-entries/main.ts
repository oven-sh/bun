// Functions that begin with a test of their first parameter, called directly with the constant zero, with another constant and with a variable.
// STATISTIC: WasmOptimizedCopies = 12
// STATISTIC: WasmDirectEntries = 12
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports as any;
for (const v of [0, 1, 2, 3, 5, 7, 40, 100, 1000]) console.log(v, e.all(v), e.sp());
for (let round = 0; round < 3; round++) console.log("again", e.all(round), e.sp());
