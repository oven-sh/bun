// The compiler sees no place where this program installs a plugin, and counts on it: a plugin decides at run time what a module is. Bun.plugin throws when the program reaches it in a way the compiler cannot follow, and the error has the code ERR_CODE_NOT_COMPILED. closed-world/plugins-admitted is the same program built with --compile-inspector.
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
