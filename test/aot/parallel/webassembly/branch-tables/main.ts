// br_table with many targets, which is a table of jumps in the code, and with few, which is a row of compares: each index, the default, and indexes far outside.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}
async function moduleAt(path: string) {
  return new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
}

const e = new WebAssembly.Instance(await moduleAt(path)).exports as any;
const indexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1000, -1, 2147483647, -2147483648];
console.log("dense", indexes.map(i => e.dense(i)).join());
console.log("sparse", indexes.map(i => e.sparse(i)).join());
console.log("withValue", indexes.map(i => e.withValue(i, 1)).join());
console.log("machine", e.machine(1), e.machine(8), e.machine(1000), e.machine(1000000));
