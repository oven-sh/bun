// A call that is written `eval(..)` under a `--define` of the name `eval` calls what the value names, also where that is a global: `bun run` calls that global and evaluates no text. The build stops at the call, in sloppy code as in a module (define-value-of-a-global-for-eval-is-called.mjs).
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
