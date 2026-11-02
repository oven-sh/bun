// A `--define` whose value is one name reads the variable that a direct call of `eval` has declared in the function, not the global of that name.
// Flags: --define NAME=target
globalThis.target = "the global";
function read() {
  eval("var target = 'declared by the evaluated text'");
  return NAME + " | " + target;
}
console.log(read());
