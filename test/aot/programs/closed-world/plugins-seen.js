// A program that calls Bun.plugin where the compiler sees it gets the answers of plain Bun, with no option.
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

attempt("Bun.plugin", () => Bun.plugin({ name: "nothing", setup() {} }));
attempt("Bun.plugin, reached in a way the compiler cannot follow", () => unknown(Bun)[decoded("plugin")]({ name: "nothing more", setup() {} }));
