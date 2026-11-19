// A load that crosses the end of the memory traps, however few of its bytes are used.
// STATISTIC: WasmOptimizedCopies = 20
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const exports = new WebAssembly.Instance(module).exports as Record<string, (pointer: number) => number>;

function outcomeOf(run: () => number): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).message.startsWith("Out of bounds memory access") ? "trap" : "other";
  }
}

for (const name of Object.keys(exports)) {
  if (name === "between_stores" || name === "stored") continue;
  const outcomes: string[] = [];
  for (let pointer = 65524; pointer <= 65537; pointer++) outcomes.push(outcomeOf(() => exports[name](pointer)));
  outcomes.push(outcomeOf(() => exports[name](-1)));
  console.log(name, outcomes.join(" "));
}
for (let pointer = 65531; pointer <= 65536; pointer++) console.log(pointer, outcomeOf(() => exports.between_stores(pointer)), exports.stored(0));
