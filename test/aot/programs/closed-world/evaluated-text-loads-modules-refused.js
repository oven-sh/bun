// A program that evaluates text where the compiler sees it keeps eval. The compiler allows for what such text reaches from the global object, not for modules that it loads: the program itself loads none by a computed name, so a load in the text throws, and the error says what to do instead. It is built with --no-compile-function-source, so the error also says to rebuild without that flag. closed-world/evaluated-text-loads-modules-admitted is the same program built with --compile-inspector.
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
