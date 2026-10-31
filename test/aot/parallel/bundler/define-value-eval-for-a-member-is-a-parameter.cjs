// A call of a member whose `--define` value is `eval` is a direct eval where the function has a parameter named `eval`: `bun run` puts the name in place of the member, and the text sees the variables of the function wherever the parameter is the function `eval`. The build stops at the call.
// Flags: --define process.env.RUN=eval
function read(eval) {
  var local = "the local";
  return process.env.RUN("typeof local");
}
console.log(
  read(eval),
  read(text => "a function got " + text),
);
/* Build errors:
error: TS100050: --aot does not support --define process.env.RUN=eval where process.env.RUN is called. The value is read as a name. A string needs quotes: --define 'process.env.RUN="eval"'
*/
