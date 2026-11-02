// A store through a `--define` whose value is `exports` stores to the parameter of that name, where a function has one: the binding decides, not the name.
// Flags: --define EXP=exports
function store(exports) {
  EXP = "stored to the parameter";
  return exports;
}
console.log(store("the argument"), typeof exports);
