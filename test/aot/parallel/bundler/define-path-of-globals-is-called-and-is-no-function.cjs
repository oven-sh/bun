// A call of a name whose `--define` value is a path throws where the last name of the path holds no function. Where the callee is the name itself, the message names the whole path, whether the first name is a `const` of the file, a name of CommonJS, a name that a direct `eval` may declare or a name that can only be a global. Where the name is in parentheses, a path whose first name can only be a global is named by its last name alone (define-path-of-globals-is-called-in-parentheses-and-is-no-function.cjs).
// Flags: --define BOUND=holder.missing --define NAMED=module.missing --define FREE=shared.missing
const holder = {};
globalThis.shared = {};
function attempt(call) {
  try {
    return call();
  } catch (error) {
    return error.message;
  }
}
function besideEval(text) {
  eval(text);
  return attempt(() => FREE());
}
console.log(attempt(() => BOUND()));
console.log(attempt(() => NAMED()));
console.log(besideEval(""));
console.log(attempt(() => FREE()));
