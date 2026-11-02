// A `--define` whose value is a dotted path reads a parameter of the enclosing function from inside an arrow function.
// Flags: --define ROOT=holder.value
function outer(holder) {
  return () => ROOT;
}
console.log(outer({ value: "the parameter" })());
