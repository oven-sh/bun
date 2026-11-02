// In an ES module nothing declares `module`, `exports` or `arguments`, yet a failed call of a name in parentheses whose `--define` value is a path below one of them names the whole path, where a path below any other global is named by its last name alone. Without the parentheses each names the whole path (define-path-of-a-global-named-module-is-called.mjs). Plain Bun names the whole path each time. Plain Bun prints another output.
// Flags: --define TARGET=target.missing --define MODULE=module.missing --define EXPORTS=exports.missing --define ARGS=arguments.missing
globalThis.target = {};
globalThis.module = {};
globalThis.exports = {};
globalThis.arguments = {};
function attempt(call) {
  try {
    return call();
  } catch (error) {
    return error.message;
  }
}
// prettier-ignore
console.log(attempt(() => (TARGET)()));
// prettier-ignore
console.log(attempt(() => (MODULE)()));
// prettier-ignore
console.log(attempt(() => (EXPORTS)()));
// prettier-ignore
console.log(attempt(() => (ARGS)()));
export {};
/* Output:
missing is not a function. (In 'missing()', 'missing' is undefined)
module.missing is not a function. (In 'module.missing()', 'module.missing' is undefined)
exports.missing is not a function. (In 'exports.missing()', 'exports.missing' is undefined)
arguments.missing is not a function. (In 'arguments.missing()', 'arguments.missing' is undefined)
*/
