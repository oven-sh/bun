// A `--define` whose value is a dotted path reads a `const` of the file that nothing else names, from inside a function.
// Flags: --define ROOT=holder.value
const holder = { value: "the binding of the file" };
function read() {
  return ROOT;
}
console.log(read());
