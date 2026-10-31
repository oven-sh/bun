// A `--define` whose value is `process.mainModule` looks `process` up where the defined name is written. Behind a direct `eval` whose text declares no `process` that is the global, and the value is the module object of the file that the program starts with.
// Flags: --define MAIN=process.mainModule
function read(text) {
  eval(text);
  return MAIN === module;
}
console.log(read(""));
