// A call of a name whose `--define` value is `eval` is a direct eval behind a comma too where the function has a parameter named `eval`: `bun run` prints the call without the comma there. The build stops at the call.
// Flags: --define RUN=eval
function read(eval) {
  var local = "the local";
  return (0, RUN)("typeof local");
}
console.log(
  read(eval),
  read(text => "a function got " + text),
);
/* Build errors:
error: TS100050: --aot does not support --define RUN=eval where RUN is called. The value is read as a name. A string needs quotes: --define 'RUN="eval"'
*/
