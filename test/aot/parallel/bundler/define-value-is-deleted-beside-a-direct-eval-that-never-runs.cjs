// `bun run` removes a direct `eval` that never runs, so JSC keeps the parameters of a sloppy function that reads its `arguments` in the arguments object: `delete` of a member whose `--define` value is the name of such a parameter answers true. The build stops at the `delete`.
// Flags: --define process.env.ALIAS=target
function ofTheParameter(target) {
  if (false) eval("var target");
  return [delete process.env.ALIAS, target, arguments[0]].join();
}
console.log(ofTheParameter("the parameter"));
/* Build errors:
error: TS100050: --aot does not support --define process.env.ALIAS=target where process.env.ALIAS is deleted. The value is read as a name. A string needs quotes: --define 'process.env.ALIAS="target"'
*/
