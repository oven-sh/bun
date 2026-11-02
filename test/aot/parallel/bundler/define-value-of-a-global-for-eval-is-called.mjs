// In a module a call that is written `eval(..)` under a `--define` of the name `eval` evaluates its text among the variables of the caller where the value names a global. Where the file declares the name of the value, or the text may declare it, the build stops at the call (define-value-for-eval-is-called.cjs, define-value-of-a-global-for-eval-is-called.cjs). Plain Bun calls the global and evaluates no text. Plain Bun prints another output.
// Flags: --define eval=target
globalThis.target = text => "the global got " + text;
function call() {
  const local = "the local";
  return eval("typeof local");
}
console.log(call());
/* Output:
string
*/
