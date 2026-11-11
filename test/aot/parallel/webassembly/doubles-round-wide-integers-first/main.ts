// A 64-bit integer becomes a float by way of a double, which rounds it first.
// STATISTIC: WasmOptimizedCopies = 13
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const exports = new WebAssembly.Instance(module).exports as Record<string, (integer: bigint, float: number) => number>;

const integers = [0x1000001000000001n, -0x1000001000000001n, 0x4000004000000001n, 0x7fff_ffbf_ffff_ffffn, 0x20_0000_1000_0001n, 0x1000001000000000n, 16777217n, -1n, 0n];
for (const name of Object.keys(exports)) {
  console.log(name, integers.map(integer => exports[name](integer, 1.5)).join(" "));
}
