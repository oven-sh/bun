// The code of a WebAssembly file beside a file that names it is compiled, though no import brings it and no read names it as a whole.
// STATISTIC: WasmOptimizedCopies = 4
// COUNTER in every build: WasmInstancesUsingImageCode = 2
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 2
import load from "./glue.cjs";

for (let turn = 0; turn < 2; turn++) {
  const e = await load();
  console.log([0, 1, 9, 10, -1].map(i => e.dense(i)).join(), [0, 1, 2, 3].map(i => e.sparse(i)).join(), e.machine(1000));
}
// Names that no file has, and one that only has the name.
const others = ["missing.wasm", "folder/missing.wasm", "/module.wasm", "http://localhost/module.wasm"];
console.log(others.length);
