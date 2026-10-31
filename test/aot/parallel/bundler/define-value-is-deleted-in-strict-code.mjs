// `bun run` puts the value of a `--define` in place of the defined name, and `delete` of a name is a SyntaxError in strict code: plain Bun runs nothing of the file. The build stops at the `delete`.
// Flags: --define process.env.ALIAS=target
const target = "the binding of the file";
console.log(delete process.env.ALIAS, target);
/* Build errors:
error: TS100050: --aot does not support --define process.env.ALIAS=target where process.env.ALIAS is deleted in strict mode. The value is read as a name. A string needs quotes: --define 'process.env.ALIAS="target"'
*/
