// A float becomes a double and a float again: a signaling NaN comes out quiet.
// STATISTIC: WasmOptimizedCopies = 16
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const exports = new WebAssembly.Instance(module).exports as Record<string, (bits: number, condition: number) => number>;

const floats = [0x7fa00000, 0xffa12345, 0x7fc54321, 0xffc00000, 0x3f800001, 0x80000001, 0x80000000, 0, 0x7f7fffff, 0xff800000];
for (const name of Object.keys(exports)) {
  for (const condition of [0, 1]) {
    console.log(name, condition, floats.map(bits => (exports[name](bits, condition) >>> 0).toString(16)).join(" "));
  }
}
