// A call of a name whose `--define` value is `require.resolve` that asks for a file stops the build also behind a direct `eval`, where the first name of the value is looked up when the code runs.
// Flags: --define RES=require.resolve
function find(text) {
  eval(text);
  return RES("./lib.cjs").endsWith("lib.cjs");
}
console.log(find(""));
/* Build errors:
error: TS100050: --aot does not support --define RES=require.resolve where RES is called. The value is read as a name. A string needs quotes: --define 'RES="require.resolve"'
*/
