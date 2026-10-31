// An ES module that names `require` has one under `bun run`, and a path whose `--define` value begins with `require` finds it: a call of a name whose value is `require.resolve` names a file of the program there too. The build stops at the call.
// Flags: --define RES=require.resolve
console.log(typeof require, RES("./lib.cjs").endsWith("lib.cjs"));
/* Build errors:
error: TS100050: --aot does not support --define RES=require.resolve where RES is called. The value is read as a name. A string needs quotes: --define 'RES="require.resolve"'
*/
