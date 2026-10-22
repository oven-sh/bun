// closed-world/evaluated-text-loads-modules-refused built with --compile-inspector. A debugger can run any code, so the compiler counts on nothing about the modules that such a build loads: the text loads modules as in plain Bun.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  const isRefusal = message.includes("the compiler couldn't tell at build time") || error.code === "ERR_CODE_NOT_COMPILED" || message.includes("bun compile differs from bun run here");
  return isRefusal ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
const evaluate = text => (0, eval)(decoded(text));

attempt("eval", () => evaluate("1 + 1"));
attempt("process.getBuiltinModule in evaluated text", () => evaluate('typeof process.getBuiltinModule("node:os").EOL'));
evaluate('import("node:os")').then(
  os => console.log("import() in evaluated text: " + typeof os.EOL),
  error => console.log("import() in evaluated text: " + outcome(error)),
);
