// `bun run` removes a class that is declared behind a `return` or a `throw`, so a `--define` whose value is the name of the class, or a path below it, finds in front of the `return` what lies further out. The build finds the class there, which is never declared, and stops at the defined name.
// Flags: --define NAME=target --define ROOT=holder.value --define RAISED=raised
globalThis.target = "the global";
globalThis.holder = { value: "the global" };
globalThis.raised = "the global";
function attempt(read) {
  try {
    return read();
  } catch (error) {
    return typeof error === "string" ? error : error.constructor.name;
  }
}
function one() {
  return NAME;
  class target {}
}
function path() {
  return ROOT;
  class holder {
    static value = "the class";
  }
}
function raises() {
  throw RAISED;
  class raised {}
}
console.log(attempt(one), attempt(path), attempt(raises));
/* Build errors:
error: TS100050: --aot does not support --define NAME=target where "target" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'NAME="target"'
error: TS100050: --aot does not support --define ROOT=holder.value where "holder" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'ROOT="holder.value"'
error: TS100050: --aot does not support --define RAISED=raised where "raised" is a let, const, class or enum in code that never runs. The value is read as a name. A string needs quotes: --define 'RAISED="raised"'
*/
