// In sloppy code `delete` of a member whose `--define` value is one name answers false where a binding of that name is in scope, and deletes the variable that an evaluated text has declared under that name. The global of that name stays.
// Flags: --define process.env.ALIAS=target --define process.env.MADE=made
const target = "the const of the file";
globalThis.target = "the global";
function made() {}
console.log(delete process.env.ALIAS, delete process.env.MADE, target, globalThis.target);
function ofTheParameter(target) {
  return [delete process.env.ALIAS, target].join();
}
console.log(ofTheParameter("the parameter"));
function declaredByTheText(text) {
  eval(text);
  return [delete process.env.ALIAS, target].join();
}
console.log(declaredByTheText("var target = 'declared by the evaluated text'"), globalThis.target);
