// The start function runs while the instance is made. Globals of every kind: its own, imported, exported, constant and not. Several results, recursion, and a stack that runs out.
// STATISTIC: WasmOptimizedCopies = 10
// STATISTIC: WasmBaselineCopies = 0
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 1
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 1
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

const counter = new WebAssembly.Global({ value: "i32", mutable: true }, 5);
const e = new WebAssembly.Instance(await moduleAt(path), { env: { base: 41, counter } }).exports as any;
console.log("start", e.started(), e.fromImport(), counter.value);
console.log("bump", e.bump(1), counter.value, ((counter.value = 100), e.bump(-1)));
console.log("big", e.big.value, e.addToBig(2n), e.big.value, e.ratio.value, e.scaled(9));
console.log("divmod", String(e.divmod(17, 5)), e.sumOfDivmod(17, 5), outcomeOf(() => e.divmod(1, 0)), outcomeOf(() => e.divmod(-2147483648, -1)));
console.log("fib", e.fib(0), e.fib(1), e.fib(20));
console.log("forever", outcomeOf(() => e.forever(1)), e.fib(10));
