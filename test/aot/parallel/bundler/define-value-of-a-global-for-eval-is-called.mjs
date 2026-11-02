// In a module too, a call that is written `eval(..)` under a `--define` of the name `eval` calls what the value names, here a global: `bun run` evaluates no text. The build stops at the call, as it does in sloppy code (define-value-of-a-global-for-eval-is-called.cjs) and where the file declares the name of the value (define-value-for-eval-is-called.cjs).
// Flags: --define eval=target
globalThis.target = text => "the global got " + text;
function call() {
  const local = "the local";
  return eval("typeof local");
}
console.log(call());
/* Plain Bun prints:
the global got typeof local
*/
/* Build errors:
error: TS100050: --aot does not support --define eval=target where eval is called
*/
