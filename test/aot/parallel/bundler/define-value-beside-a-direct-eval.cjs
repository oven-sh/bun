// A `--define` whose value is one name is looked up when the function runs, where the function calls `eval`: it is the global, or the variable that the evaluated text has declared.
// Flags: --define NAME=target
globalThis.target = "the global";
function read(text) {
  eval(text);
  return NAME;
}
console.log(read(""), "|", read("var target = 'declared by the evaluated text'"));
