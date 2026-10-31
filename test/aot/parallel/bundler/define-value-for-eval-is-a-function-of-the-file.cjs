// A call of `eval` under a `--define` of that name calls what the value names, also where that is a function of the file and the call is written in another function: `bun run` evaluates no text there. The build stops at the call.
// Flags: --define eval=target
function target(text) {
  return "the function of the file got " + text;
}
function call() {
  return eval("1 + 1");
}
console.log(call());
/* Build errors:
error: TS100050: --aot does not support --define eval=target where eval is called. The value is read as a name. A string needs quotes: --define 'eval="target"'
*/
