// JSC keeps the parameters of sloppy code that reads its `arguments` in the arguments object where no closure captures one: those of a function, and `require` in a CommonJS file. `delete` of a member whose `--define` value names one answers true, and the build stops at each such `delete`.
// Flags: --define process.env.ALIAS=target --define process.env.LOAD=require
function ofTheParameter(target) {
  const first = arguments[0];
  return [delete process.env.ALIAS, target, first].join();
}
const own = arguments[0];
console.log(ofTheParameter("the parameter"), delete process.env.LOAD, own === exports, typeof require);
/* Build errors:
error: TS100050: --aot does not support --define process.env.ALIAS=target where process.env.ALIAS is deleted. The value is read as a name. A string needs quotes: --define 'process.env.ALIAS="target"'
error: TS100050: --aot does not support --define process.env.LOAD=require where process.env.LOAD is deleted. The value is read as a name. A string needs quotes: --define 'process.env.LOAD="require"'
*/
