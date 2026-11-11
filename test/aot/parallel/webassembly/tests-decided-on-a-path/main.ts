// A value is tested twice. Between the tests is a branch that is never taken and would carry another result out of the same block.
// STATISTIC: WasmOptimizedCopies = 27
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
let calls = 0;
const exports = new WebAssembly.Instance(module, { env: { hook: () => void calls++ } }).exports as Record<string, (first: number, second: number) => number>;

for (const name of Object.keys(exports)) {
  console.log(name, [0, 1, 2, -1, -590730549].map(second => exports[name](7, second)).join(" "), calls);
}
