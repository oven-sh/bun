// The realm of a Worker is one more realm of the same program: an evaluator that the worker reaches in a way the compiler cannot follow throws there too. main.js is the program; this file, a second entry point of the build, is what the Worker runs. closed-world/evaluators-in-a-worker-admitted is the same program built with --compile-inspector.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function attempt(label, action) {
  try {
    return label + ": " + action();
  } catch (error) {
    const message = String(error.message);
    return label + ": " + (message.includes("the compiler couldn't tell at build time") ? "refused: " + message : error.name);
  }
}
const text = decoded("1 + 1");
const realm = unknown(globalThis);
postMessage([attempt("eval in a worker", () => realm[decoded("eval")](text)), attempt("Function in a worker", () => realm[decoded("Function")]("return " + text)())].join("\n"));
