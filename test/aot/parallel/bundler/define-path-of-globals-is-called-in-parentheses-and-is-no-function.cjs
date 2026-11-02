// A call of a name in parentheses whose `--define` value is a path throws where the last name of the path holds no function. The message names the whole path where the first name is a `const` of the file, a name of CommonJS or a name that a direct `eval` may declare, and the last name alone where the first name can only be a global. Without the parentheses it names the whole path for each (define-path-of-globals-is-called-and-is-no-function.cjs). Plain Bun names the whole path each time. Plain Bun prints another output.
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
  // prettier-ignore
  return attempt(() => (FREE)());
}
// prettier-ignore
console.log(attempt(() => (BOUND)()));
// prettier-ignore
console.log(attempt(() => (NAMED)()));
console.log(besideEval(""));
// prettier-ignore
console.log(attempt(() => (FREE)()));
/* Output:
holder.missing is not a function. (In 'holder.missing()', 'holder.missing' is undefined)
module.missing is not a function. (In 'module.missing()', 'module.missing' is undefined)
shared.missing is not a function. (In 'shared.missing()', 'shared.missing' is undefined)
missing is not a function. (In 'missing()', 'missing' is undefined)
*/
