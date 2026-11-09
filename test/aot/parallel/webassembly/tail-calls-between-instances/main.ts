// A tail call that leaves the instance, for another instance or for JavaScript: whoever called the function that left has its own instance and memory again when the call returns.
/// <reference path="../wasm-files.d.ts" />
// Env of the executable: BUN_JSC_crashIfInterpreterIsUsed=1
import path from "./module.wasm";
import otherPath from "./other.wasm";

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

const other = new WebAssembly.Instance(await moduleAt(otherPath)).exports;
const e = new WebAssembly.Instance(await moduleAt(path), { other, env: { twice: (n: number) => n * 2 } }).exports as any;
console.log("peekThenOwn", e.peekThenOwn(0), e.peekThenOwn(1));
console.log("indirectThenOwn", e.indirectThenOwn(0, 0), e.indirectThenOwn(1, 0), e.indirectThenOwn(2, 21), outcomeOf(() => e.indirectThenOwn(3, 0)));
console.log("twiceThenOwn", e.twiceThenOwn(4));
console.log("count", e.count(0, 1), e.count(10, 0), e.count(5000000, 0));
console.log("spreadThenOwn", e.spreadThenOwn(1), e.spreadThenOwn(-3));
let total = 0;
for (let i = 0; i < 20000; i++) total = (total + e.peekThenOwn(i & 1) + e.indirectThenOwn(i % 3, i & 7) + e.twiceThenOwn(i) + e.spreadThenOwn(i)) | 0;
console.log("many", total);
