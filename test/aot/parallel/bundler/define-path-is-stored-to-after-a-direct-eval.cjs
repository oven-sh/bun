// Where a function calls `eval`, a store through a defined name whose `--define` value is a dotted path reaches the member of the variable that the evaluated text has declared under the first name, and of the global where it has declared none.
// Flags: --define ROOT=holder.value
globalThis.holder = { value: "the global" };
function store(text) {
  eval(text);
  ROOT = "stored";
  ROOT += "!";
  return typeof holder === "undefined" ? "none" : holder.value;
}
console.log(store("var holder = { value: 'declared by the evaluated text' }"), globalThis.holder.value);
console.log(store(""), globalThis.holder.value);
