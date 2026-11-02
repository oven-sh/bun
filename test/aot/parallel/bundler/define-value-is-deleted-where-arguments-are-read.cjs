// `delete` of a member whose `--define` value names a parameter of a sloppy function that reads its `arguments`, or `require` in a CommonJS file that reads its own, answers false and removes nothing, as `delete` of the name does. JSC keeps such parameters in the arguments object and answers true under `bun run`. Plain Bun prints another output.
// Flags: --define process.env.ALIAS=target --define process.env.LOAD=require
function ofTheParameter(target) {
  const first = arguments[0];
  return [delete process.env.ALIAS, target, first].join();
}
const own = arguments[0];
console.log(ofTheParameter("the parameter"), delete process.env.LOAD, own === exports, typeof require);
/* Output:
false,the parameter,the parameter false true function
*/
