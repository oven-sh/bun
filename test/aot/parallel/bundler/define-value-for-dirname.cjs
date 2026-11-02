// A `--define` of `__dirname` whose value is one name reads the parameter of that name, not the global of that name.
// Flags: --define __dirname=dir
globalThis.dir = "the global";
function f(dir) {
  return __dirname;
}
console.log(f("the parameter"));
