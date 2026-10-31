// A call of a name whose `--define` value is `eval` is a direct eval wherever the name `eval` has the function `eval` for a value there: also where it is a parameter. The build stops at the call.
// Flags: --define RUN=eval
function read(eval) {
  var local = "the local";
  return RUN("typeof local");
}
console.log(
  read(eval),
  read(text => "a function got " + text),
);
/* Build errors:
error: TS100050: --aot does not support --define RUN=eval where RUN is called. The value is read as a name. A string needs quotes: --define 'RUN="eval"'
*/
