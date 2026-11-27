// Tests of bits of loads at constant addresses, some of which end behind the memory though the byte with the bits is in it.
// STATISTIC: WasmOptimizedCopies = 225
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()))).exports as any;
const bytes = new Uint8Array(e.memory.buffer);
const rows = new Map<string, string[]>();
for (const pattern of [0, 0xff, 0x01, 0x80, 0x55]) {
  bytes.fill(pattern, 0, 16);
  bytes.fill(pattern, 65520);
  for (const name in e) {
    if (name === "memory") continue;
    let result: string;
    try {
      result = String(e[name](0));
    } catch {
      result = "trap";
    }
    const key = name.slice(0, name.lastIndexOf("_"));
    rows.set(key, [...(rows.get(key) ?? []), result]);
  }
}
for (const [key, results] of rows) console.log(key, results.join(" "));
