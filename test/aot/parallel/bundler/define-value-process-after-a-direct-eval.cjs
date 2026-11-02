// A `--define` whose value is `process` looks the name up where the defined name is written. Behind a direct `eval` whose text declares no `process` that is the global, whose `mainModule` is the module object of the file that the program starts with.
// Flags: --define HOST=process
function read(text) {
  eval(text);
  return HOST.mainModule === module;
}
console.log(read(""));
