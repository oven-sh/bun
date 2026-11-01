// The compiler finds nothing in this program that evaluates text, and counts on it. node:worker_threads goes through a value that it cannot follow, and its Worker is made from text that is decoded at run time. That text runs apart from the compiled program, as in plain Bun, so it may evaluate more text. That opens nothing in the program: its own eval is refused before the Worker is made, when its message arrives and after it has ended.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
// Alone: whether the program's own eval is refused depends on whether anything else in the executable evaluates text
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
const threads = unknown(require("node:worker_threads"));
function evaluate(when) {
  try { console.log(when + ", the program evaluates: " + unknown(globalThis)[decoded("eval")](decoded("1 + 1"))); } catch (error) { console.log(when + ", the program evaluates: " + error.name); }
}
const text = `require("node:worker_threads").parentPort.postMessage([eval("2 + 3"), new Function("return 7")(), require("node:vm").runInNewContext("4 + 4")].join(" "))`;
evaluate("before the Worker is made");
new threads[decoded("Worker")](decoded(text), { eval: true })
  .on("message", message => (console.log("the text of the Worker evaluates: " + message), evaluate("when its message arrives")))
  .on("error", error => console.log("error: " + error.name))
  .on("exit", code => (console.log("exit: " + code), evaluate("after it has ended")));
/* Output:
before the Worker is made, the program evaluates: EvalError
the text of the Worker evaluates: 5 7 8
when its message arrives, the program evaluates: EvalError
exit: 0
after it has ended, the program evaluates: EvalError
*/
