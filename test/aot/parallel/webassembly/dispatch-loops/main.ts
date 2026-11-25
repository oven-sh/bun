// State machines written as a loop around a br_table on a local: entered at every state, with the next state stored as a constant, computed, out of range, stored early, stored twice, or passed beside a value.
// STATISTIC: WasmOptimizedCopies = 13
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// STATISTIC: WasmJumpsThreaded = 36
// STATISTIC: WasmFirstStateTests = 5
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 1
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
const e = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as any;
const states = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 100, -1, 2147483647, -2147483648];
const counts = [0, 1, 2, 3, 7, 10, 100];

function table(name: string, run: (state: number, count: number) => unknown) {
  for (const count of counts) console.log(name, count, states.map(state => run(state, count)).join());
}

table("sumBelow", (state, n) => e.sumBelow(state, n));
console.log("sumBelowFromStart", counts.map(n => e.sumBelowFromStart(n)).join());
console.log("sumBelowFromTest", counts.map(n => e.sumBelowFromTest(n)).join());
table("mixed", (state, n) => e.mixed(state, Math.min(n, 40)));
table("conditional", (state, n) => e.conditional(state, n * 2654435761));
table("computed", (state, n) => e.computed(state, n));
table("stores", (state, n) => e.stores(state, n));
console.log("countsDispatches", states.map(state => e.countsDispatches(state)).join());
console.log("loopWithParameter", states.map(state => e.loopWithParameter(state)).join());
console.log("tableWithValue", states.map(state => e.tableWithValue(state)).join());
table("otherLocal", (state, other) => e.otherLocal(state, other));
for (const inner of [0, 1, 2, 3, -1]) table("nested " + inner, (outer, n) => e.nested(outer, inner, n));
console.log("tableNamesLoop", states.filter(state => state !== 2).map(state => e.tableNamesLoop(state, 0)).join());
console.log("long run", e.sumBelow(0, 3000000), e.mixed(0, 30), e.computed(0, 3000000), e.conditional(0, -1));
