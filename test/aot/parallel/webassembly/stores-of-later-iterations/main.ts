// A loop stores twice to an address, with a read between, and goes on to the next address. Only a trap ends it.
// STATISTIC: WasmOptimizedCopies = 16
// COUNTER in every build: WasmInstancesInterpreted = 0
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const { memory, ...functions } = new WebAssembly.Instance(module).exports as Record<string, (address: number) => void> & { memory: WebAssembly.Memory };
const bytes = new Uint8Array(memory.buffer);

for (const name of Object.keys(functions)) {
  bytes.fill(0);
  let outcome = "returned";
  try {
    functions[name](name === "downward" ? 400 : 0);
  } catch (error) {
    outcome = (error as Error).constructor.name;
  }
  const sums = [0, 64, 1024, 4096, 65528].map(begin => bytes.subarray(begin, begin + 64).reduce((sum, byte) => sum + byte, 0));
  console.log(name, outcome, sums.join(" "));
}
