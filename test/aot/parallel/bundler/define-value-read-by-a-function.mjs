// A `--define` whose value is one name reads the `const` of the module that has that name, from inside a function.
// Flags: --define NAME=target
const target = "the binding of the file";
function read() {
  return NAME;
}
console.log(read());
