// `bun run` puts the value of a `--define` in place of the defined name, so a call of a name whose value is `eval` runs its text among the variables of the caller. The build stops at such a call.
// Flags: --define RUN=eval
function read() {
  var local = "the local";
  return RUN("typeof local");
}
console.log(read());
/* Build errors:
error: TS100050: --aot does not support --define RUN=eval where RUN is called. The value is read as a name. A string needs quotes: --define 'RUN="eval"'
*/
