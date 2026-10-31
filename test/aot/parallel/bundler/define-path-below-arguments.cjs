// A `--define` whose value is `arguments.length` reads the arguments of the function, not a global of the name `arguments`.
// Flags: --define ARGC=arguments.length
globalThis.arguments = { length: "the global" };
function count() {
  return ARGC;
}
console.log(count(1, 2, 3));
