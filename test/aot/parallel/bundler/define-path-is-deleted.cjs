// `delete` of a member whose `--define` value is a dotted path deletes the member of the `const` of the file, of the parameter, or of the variable that an evaluated text has declared, that has the first name of the path.
// Flags: --define process.env.ALIAS=holder.value
const holder = { value: "of the const of the file" };
globalThis.holder = { value: "of the global" };
console.log(delete process.env.ALIAS, "value" in holder, "value" in globalThis.holder);
function ofTheParameter(holder) {
  return [delete process.env.ALIAS, "value" in holder].join();
}
console.log(ofTheParameter({ value: 1 }), ofTheParameter(Object.freeze({ value: 1 })));
function declaredByTheText(text) {
  eval(text);
  return [delete process.env.ALIAS, "value" in holder].join();
}
console.log(declaredByTheText("var holder = { value: 1 }"), "value" in globalThis.holder);
