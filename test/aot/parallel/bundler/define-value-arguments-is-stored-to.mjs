// In strict code a store to `arguments` is a SyntaxError, so under `bun run` a file does not load where a store has a name whose `--define` value is `arguments`. The build stops at such a store.
// Flags: --define ARGS=arguments
function replace() {
  ARGS = ["stored"];
  return arguments[0];
}
function count() {
  ARGS++;
  return arguments[0];
}
console.log(replace("the argument"), count("the argument"));
/* Plain Bun prints:
exit code 1
SyntaxError: Cannot modify 'arguments' in strict mode.
*/
/* Build errors:
error: TS100050: --aot does not support --define ARGS=arguments where ARGS is stored to in strict mode
*/
