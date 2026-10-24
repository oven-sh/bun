// closed-world/import-of-text-refused built with --compile-inspector. A debugger can run any code, so the compiler counts on nothing about the code that such a build runs: both modules load as in plain Bun.
// What native code hands back is unknown to the compiler, and so is text that is decoded at run time.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const decoded = text => Buffer.from(text).toString();
function outcome(error) {
  const message = String(error.message);
  const isRefusal = message.startsWith("Code generation from strings disallowed") || message.includes("it isn't in this executable");
  return isRefusal ? "refused: " + message.replace(/'.*?'/, "'..'") : error.name;
}
function attempt(label, action) {
  try { console.log(label + ": " + action()); } catch (error) { console.log(label + ": " + outcome(error)); }
}
async function imported(label, specifier) {
  try { console.log(label + ": " + (await import(specifier)).default); } catch (error) { console.log(label + ": " + outcome(error)); }
}
async function main() {
  const text = decoded("export default 1 + 1;");
  await imported("import of a data: URL", "data:text/javascript," + encodeURIComponent(text));
  await imported("import of a blob: URL", URL.createObjectURL(new Blob([text], { type: "text/javascript" })));
}
main();
