// A module without a memory calls through its table with six arguments: a function of its own instance, and one of another instance.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import modulePath from "./module.wasm";

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

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(modulePath).arrayBuffer()));
const one: any = new WebAssembly.Instance(module, {}).exports;
const other: any = new WebAssembly.Instance(module, {}).exports;
console.log("its own", one.indirect(1, 2, 3, 4, 5, 6, 0), one.indirectTwice(1, 2, 3, 4, 5, 6, 0));
console.log(
  "nothing",
  outcomeOf(() => one.indirect(1, 2, 3, 4, 5, 6, 1)),
);
one.table.set(1, other.weighted);
console.log("of another instance", one.indirect(6, 5, 4, 3, 2, 1, 1), one.indirectTwice(6, 5, 4, 3, 2, 1, 1));
console.log(
  "outside",
  outcomeOf(() => one.indirect(1, 2, 3, 4, 5, 6, 3)),
);
