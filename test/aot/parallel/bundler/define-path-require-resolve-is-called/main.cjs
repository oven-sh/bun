// A call of `require.resolve` names a file of the program, and the build finds such calls in the text of a file. It finds none where a `--define` writes `require.resolve` in front of the arguments: the build stops at such a call that asks for a file.
// Flags: --define RES=require.resolve
console.log(RES("./lib.cjs").endsWith("lib.cjs"));
/* Build errors:
error: TS100050: --aot does not support --define RES=require.resolve where RES is called. The value is read as a name. A string needs quotes: --define 'RES="require.resolve"'
*/
