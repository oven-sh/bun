// A `--define` whose value is `arguments.length` reads the arguments of the function that the defined name is written in.
// Flags: --define ARGC=arguments.length
function count() {
  return ARGC;
}
console.log(count(1, 2, 3));
