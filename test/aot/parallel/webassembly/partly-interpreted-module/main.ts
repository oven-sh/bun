// Functions with tail calls or exception handling are interpreted and the rest of the module is compiled: calls, tail calls, exceptions and traps cross between the two in both directions.
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

const wasm: any = WebAssembly;
function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    if (error instanceof wasm.Exception) return "WebAssembly.Exception: " + (error as any).getArg(e.oops, 0);
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const env = { fail: (n: number) => { if (n) throw new RangeError("thrown by JavaScript: " + n); } };
const e = new WebAssembly.Instance(module, { env }).exports as any;
console.log("sum", e.sum(0), e.sum(1), e.sum(10), e.sum(1000), e.sumTo(3, 100), e.step(3, 100));
console.log("count", e.count(0), e.count(10), e.count(1000000), e.countDown(1000000, 0));
console.log("spread", e.sumOfTen(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), e.spread(1), e.callSpread(1), e.callSpread(-5));
console.log("middle", e.throwIf(0), outcomeOf(() => e.throwIf(2)), e.middle(0), outcomeOf(() => e.middle(5)));
console.log("catcher", e.catcher(0), e.catcher(5), e.catcher(-1));
console.log("callFail", e.callFail(0), outcomeOf(() => e.callFail(3)), e.catchAll(0), e.catchAll(3));
console.log("divide", e.divide(7, 2), outcomeOf(() => e.divide(1, 0)), e.tailDivide(7, 2), outcomeOf(() => e.tailDivide(1, 0)), e.catchAllDivide(9, 3), outcomeOf(() => e.catchAllDivide(1, 0)));
for (let i = 0; i < 5; i++) console.log("table", i, outcomeOf(() => e.viaTable(i, 4)), outcomeOf(() => e.tailViaTable(i, 4)), outcomeOf(() => e.viaTable(i, 0)));
console.log("deep", outcomeOf(() => e.sum(10000000)), e.sum(10));
let total = 0;
for (let i = 0; i < 20000; i++) total = (total + e.catcher(i & 3) + e.catchAll(i & 1) + e.callSpread(i) + e.sum(i & 15) + e.tailViaTable(i & 1, i)) | 0;
console.log("many", total);
