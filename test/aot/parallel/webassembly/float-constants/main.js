// Functions with floating-point constants are compiled by the optimizing tier, and the constants they load are the ones in the module.
// STATISTIC: WasmFunctionsCompiled = 3
// STATISTIC: WasmOptimizedCopies = 3
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 1
import path from "./module.wasm";
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const { scale, half, many } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
for (const value of [0, 1, -2, 0.1, 1e308, -0, NaN, Infinity]) console.log(value, scale(value), half(value), many(value));
