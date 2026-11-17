// Atomic operations on one byte whose result is dropped, with the operand and the address in every register that an argument has.
// STATISTIC: WasmOptimizedCopies = 189
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const exports = new WebAssembly.Instance(module).exports as any;
const bytes = new Uint8Array(exports.memory.buffer);

for (const name of Object.keys(exports)) {
  if (name === "memory") continue;
  const results: string[] = [];
  for (const old of [0xf0, 0x0f, 0x55]) {
    bytes.fill(0, 0, 4096);
    const operands = [0x111, 0x222, 0x344, 0x488, 0x5a5, 0x63c];
    for (const at of operands) bytes[at] = bytes[at + 8] = old;
    if (name.startsWith("wide_")) exports[name](operands[0], ...operands.slice(1).map(BigInt));
    else if (name.startsWith("half_")) exports[name](operands[2], 0x1d2c, 0, 0, 0, 0);
    else exports[name](...operands);
    let seen = "";
    for (let at = 0; at < 4096; at++) if (bytes[at] !== 0 && bytes[at] !== old) seen += " " + at + ":" + bytes[at];
    for (const at of operands) if (bytes[at] === 0 || bytes[at + 8] === 0) seen += " zero at " + at;
    results.push(seen);
  }
  console.log(name + results.join(" |"));
}
