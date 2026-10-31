// A call of a member whose `--define` value is `eval` is a direct eval where a function around it has a parameter named `eval`, also behind a direct `eval` whose text may declare the name again. The build stops at the call.
// Flags: --define process.env.RUN=eval
function outer(eval, text) {
  function read() {
    var local = "the local";
    eval(text);
    return process.env.RUN("typeof local");
  }
  return read();
}
console.log(
  outer(eval, "1"),
  outer(text => "a function got " + text, "1"),
);
/* Build errors:
error: TS100050: --aot does not support --define process.env.RUN=eval where process.env.RUN is called. The value is read as a name. A string needs quotes: --define 'process.env.RUN="eval"'
*/
