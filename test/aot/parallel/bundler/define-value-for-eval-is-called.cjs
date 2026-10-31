// `bun run` puts the value of a `--define` in place of the defined name. Where the defined name is `eval`, a call of it calls what the value names, here a parameter of the function, and evaluates no text. The build stops at the call.
// Flags: --define eval=target
function call(target) {
  return eval("1 + 1");
}
console.log(call(text => "the parameter got " + text));
/* Build errors:
error: TS100050: --aot does not support --define eval=target where eval is called. The value is read as a name. A string needs quotes: --define 'eval="target"'
*/
