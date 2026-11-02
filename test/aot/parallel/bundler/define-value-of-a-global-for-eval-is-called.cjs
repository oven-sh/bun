// In sloppy code the text of a direct `eval` may declare any name in the function around it. So the build stops at a call that is written `eval(..)` under a `--define` of the name `eval` also where the value names a global: `bun run` calls that global and evaluates no text. In a module the text can declare nothing outside itself, and the same call evaluates its text (define-value-of-a-global-for-eval-is-called.mjs).
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
