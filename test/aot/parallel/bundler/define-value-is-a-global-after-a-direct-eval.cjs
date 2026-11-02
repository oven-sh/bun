// A `--define` value whose first name nothing declares is read from the global after a direct `eval` too, and a built-in that the text of the `eval` declares again is what the text declared.
// Flags: --define LOG=console.log --define ROOT=holder.value --define DEEP=Bun.deepEquals
globalThis.holder = { value: "the global" };
function read(text) {
  eval(text);
  return [typeof LOG, ROOT, LOG === console.log, DEEP([1], [1])].join();
}
console.log(read(""));
console.log(
  read("var console = { log: 'what the text declared' }, Bun = { deepEquals: () => 'what the text declared' }"),
);
