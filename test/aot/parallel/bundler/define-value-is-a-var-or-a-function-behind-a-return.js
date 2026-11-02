// A `var` and a function that are declared behind a `return` are declared for all of their function, and `bun run` keeps both: a `--define` whose value is such a name, or a path below it, finds the variable of the function in front of the `return`, as the name itself does.
// Flags: --define NAME=target --define MAKE=make --define ROOT=holder.value --define PATH=lister.name
globalThis.target = "the global";
globalThis.make = () => "the global";
globalThis.holder = { value: "the global" };
globalThis.lister = { name: "the global" };
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return error.constructor.name;
  }
}
function ofAVar() {
  return NAME;
  var target = "never stored";
}
function ofAFunction() {
  return MAKE();
  function make() {
    return "the function";
  }
}
function belowAVar() {
  return ROOT;
  var holder = { value: "never stored" };
}
function belowAFunction() {
  return PATH;
  function lister() {}
}
console.log(attempt(ofAVar), attempt(ofAFunction), attempt(belowAVar), attempt(belowAFunction));
