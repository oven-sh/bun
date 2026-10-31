// `delete` of a member that a `--define` gives one name deletes the variable that the text of a direct `eval` declared under that name, and the global where the text declared none.
// Flags: --define process.env.ALIAS=target
globalThis.target = "the global";
function remove(text) {
  eval(text);
  const before = eval("target");
  return [before, delete process.env.ALIAS, eval("typeof target")].join();
}
console.log(remove("var target = 'declared'"));
console.log(remove(""), typeof globalThis.target);
