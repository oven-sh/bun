// In an ES module nothing declares `module`, `exports` or `arguments`. Where the callee is the name itself, a failed call of a name whose `--define` value is a path below one of them names the whole path, as a path below any other global does. Where the name is in parentheses, a path below any other global is named by its last name alone (define-path-of-a-global-named-module-is-called-in-parentheses.mjs).
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
console.log(attempt(() => TARGET()));
console.log(attempt(() => MODULE()));
console.log(attempt(() => EXPORTS()));
console.log(attempt(() => ARGS()));
export {};
