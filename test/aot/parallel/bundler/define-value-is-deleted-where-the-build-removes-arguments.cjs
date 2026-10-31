// JSC keeps the parameters of a sloppy function in the arguments object wherever the text that `bun run` keeps names `arguments`, also where the build folds that read away, so `delete` of a member whose `--define` value names a parameter answers true. The build stops at the `delete`.
// Flags: --define process.env.ALIAS=target
let verbose = false;
function ofTheParameter(target) {
  if (verbose) console.log(arguments[0]);
  return [delete process.env.ALIAS, target].join();
}
console.log(ofTheParameter("the parameter"));
/* Build errors:
error: TS100050: --aot does not support --define process.env.ALIAS=target where process.env.ALIAS is deleted. The value is read as a name. A string needs quotes: --define 'process.env.ALIAS="target"'
*/
