// Plain Bun leaves out a `--define` value that nothing uses. A statement that is only the defined name reads nothing: it does not throw in the dead zone of the `const` that the value names.
// Flags: --define NAME=target --define ROOT=holder.value
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}
function early() {
  NAME;
  void NAME;
  ROOT;
  return "no throw";
}
console.log(attempt(early));
const target = "the binding of the file";
const holder = { value: "the member" };
console.log(attempt(early), NAME, ROOT);
