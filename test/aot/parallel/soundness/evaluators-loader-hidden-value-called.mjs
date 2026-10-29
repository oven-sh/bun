// eval, Function and require reach a parameter that also takes a value that the compiler cannot follow, and are called there. ../../flow-schedules.test.ts builds it under four schedules.
const hide = value => new CustomEvent("x", { detail: value }).detail;
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function call(callee, operand) {
  hide(callee);
  return callee(operand);
}
call(hide(x => x), 1);
const e0 = { get: () => eval };
const e = () => e0.get();
const f0 = { get: () => Function };
const f = () => f0.get();
const r0 = { get: () => require };
const r = () => r0.get();
const attempt = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, "THROWS", error.name, String(error.message).slice(0, 50)); } };
attempt("eval", () => call(e(), "1 + 1"));
attempt("Function", () => call(f(), "return 2 + 2")());
attempt("require", () => typeof call(r(), "node:path").join);
