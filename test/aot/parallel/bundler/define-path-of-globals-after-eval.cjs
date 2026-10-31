// A `--define` whose value is a path of globals reads the globals also in a function that calls `eval`, where the evaluated text declares none of them.
// Flags: --define LOG=console.log --define ROOT=holder.value
function f(text) {
  eval(text);
  return typeof LOG + " " + ROOT;
}
globalThis.holder = { value: "the global" };
console.log(f(""));
