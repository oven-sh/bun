// The first name of a `--define` value is looked up where the defined name is written. After a direct `eval` that is first a variable that the text of the `eval` declared, then the binding in scope, then the global.
// Flags: --define NAME=target --define ROOT=holder.value --define OWN=own --define ABSENT=absent
globalThis.target = "the global";
globalThis.holder = { value: "the global" };
const own = "the binding of the file";
const declarations =
  "var target = 'declared', holder = { value: 'of the declared holder' }, own = 'declared', absent = 1";
function read(text) {
  eval(text);
  return [NAME, ROOT, typeof NAME, OWN, typeof ABSENT].join();
}
console.log(read(""));
console.log(read(declarations));
function closes(text) {
  eval(text);
  return () => [NAME, ROOT, OWN].join();
}
console.log(closes("")());
console.log(closes(declarations)());
function takes(own = "the parameter", text) {
  eval(text);
  return (() => OWN)();
}
console.log(takes(undefined, ""), takes(undefined, declarations));
