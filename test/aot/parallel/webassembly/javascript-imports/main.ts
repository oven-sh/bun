// Calls from a module to functions of JavaScript: each type of argument and result, more arguments than there are registers, results that have to be converted, and results that cannot be.
// STATISTIC: WasmOptimizedCopies = 10
// STATISTIC: WasmBaselineCopies = 1
// STATISTIC: WasmOptimizedCheckingCopies = 0
// STATISTIC: WasmBaselineCheckingCopies = 0
// COUNTER in every build: WasmInstancesUsingImageCode = 2
// COUNTER in every build: WasmInstancesInterpreted = 0
// COUNTER in every build: WasmModulesFoundBeforeParsing = 2
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

let answer: unknown = 0;
const seen: unknown[] = [];
const take = (...values: unknown[]) => (seen.push(...values), answer);
const env = { i32: take, i64: take, f32: take, f64: take, ref: take, fn: take, none: take, pair: take, many: take, vector: take };
const e = new WebAssembly.Instance(await moduleAt(path), { env }).exports as any;
const tryEach = (name: string, argument: unknown, answers: unknown[]) => {
  const outcomes = answers.map(value => ((answer = value), outcomeOf(() => e[name](argument)))).join(" | ");
  const first = seen.splice(0)[0];
  console.log(name, outcomes, "saw", typeof first === "function" ? "a function" : String(first));
};
const object = { valueOf: () => 42 };
tryEach("callI32", -3, [7, 2.9, -0.5, 4294967297, "12", null, undefined, true, object, NaN, 5n, Symbol.iterator]);
tryEach("callI64", 1n << 62n, [7n, -1n, 1n << 64n, true, "12", 7, null, object]);
tryEach("callF32", 0.1, [1, 0.1, 1e40, "2.5", undefined, object, 5n]);
tryEach("callF64", 0.1, [1, 0.1, 1e400, "2.5", null, object, 5n]);
tryEach("callRef", object, [object, null, undefined, 1.5, "text"]);
tryEach("callFn", undefined, [null, e.callI32, () => 1, 5]);
tryEach("callNone", undefined, [1, "ignored"]);
tryEach("callPair", undefined, [[1, 0.5], new Set([2, 0.25]), [1], [1, 2, 3], 5, null, ["3", object]]);
answer = 0.125;
console.log("callMany", e.callMany(1), seen.splice(0).join());
console.log("callVector", outcomeOf(() => e.callVector()), seen.length);
answer = 3;
console.log("sumOfCalls", e.sumOfCalls(1), e.sumOfCalls(100000), seen.splice(0).length);
env.i32 = () => 0;
console.log("the import is what it was", e.callI32(1));
const throwing = new WebAssembly.Instance(await moduleAt(path), { env: { ...env, i32: () => { throw new TypeError("thrown by a function of JavaScript"); } } }).exports as any;
console.log("throwing", outcomeOf(() => throwing.callI32(1)), outcomeOf(() => throwing.sumOfCalls(3)), throwing.callF64(1));
