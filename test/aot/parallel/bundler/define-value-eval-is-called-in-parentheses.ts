// A call of a name whose `--define` value is `eval` runs its text among the variables of the caller also where the name is in parentheses, behind a cast or in front of `!`. The build stops at each such call.
// Flags: --define WRAPPED=eval --define CAST=eval --define SURE=eval
declare const WRAPPED: typeof eval;
declare const CAST: unknown;
declare const SURE: typeof eval | undefined;
function read(): string {
  var local = "the local";
  // prettier-ignore
  return [(WRAPPED)("typeof local"), (CAST as typeof eval)("typeof local"), SURE!("typeof local")].join();
}
console.log(read());

export {};
/* Build errors:
error: TS100050: --aot does not support --define WRAPPED=eval where WRAPPED is called. The value is read as a name. A string needs quotes: --define 'WRAPPED="eval"'
error: TS100050: --aot does not support --define CAST=eval where CAST is called. The value is read as a name. A string needs quotes: --define 'CAST="eval"'
error: TS100050: --aot does not support --define SURE=eval where SURE is called. The value is read as a name. A string needs quotes: --define 'SURE="eval"'
*/
