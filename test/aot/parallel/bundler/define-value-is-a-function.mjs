// A `--define` whose value is one name calls the function of the module that has that name, which nothing else calls.
// Flags: --define NAME=target
function target() {
  return "the function of the file";
}
console.log(NAME());
