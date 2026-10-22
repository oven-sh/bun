// closed-world/plugins-refused built with --compile-inspector. A debugger can run any code, so the compiler counts on nothing about the code that such a build runs: Bun.plugin answers as in plain Bun.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  return error.code === "ERR_CODE_NOT_COMPILED" ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}

attempt("Bun.plugin", () => unknown(Bun)[decoded("plugin")]({ name: "nothing", setup() {} }));
