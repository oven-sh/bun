// Functions that switch on their only parameter first, called directly and through a table with constant and variable states, their results branched on and used.
// STATISTIC: WasmOptimizedCopies = 7
// STATISTIC: WasmDirectEntries = 7
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports as any;
const words = new BigInt64Array(e.memory.buffer);
for (let i = 0; i < words.length; i++) words[i] = BigInt(i * 7 + 1);
const digest = () => words.reduce((sum, word) => BigInt.asIntN(64, sum * 31n + word), 0n);
for (const v of [0, 1, 2, 3, 4, 7, 100, 127, -1]) console.log(v, e.all(v), e.sp(), digest());
for (const name of ["constants", "dynamic", "usesState", "leaves", "countsDown"]) {
  const direct = [0, 1, 2, 3, 4, -1].map(state => {
    new DataView(e.memory.buffer).setInt32(e.sp() + 64, 3, true);
    return e[name](state);
  });
  console.log(name, direct.join(" "), e.sp(), digest());
}
for (let i = 0; i < 4; i++) console.log("table", i, [0, 1, 2, 3].map(state => e.table.get(i)(state)).join(" "));
