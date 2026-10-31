// Behind a direct `eval` of sloppy code `bun run` still prints what a `--define` gives NAME alone in front of the arguments of `(0, NAME)()`, and answers the call itself where that is the name of the `feature` import of "bun:bundle". The build stops at such a call.
// Flags: --define NAME=feature
import { feature } from "bun:bundle";
globalThis.feature = () => "the global was called";
function probe(text) {
  eval(text);
  return (0, NAME)("SUPER_SECRET") ? "on" : "off";
}
console.log(probe(""));
/* Build errors:
error: TS100050: --aot does not support --define NAME=feature where NAME is called. The value is read as a name. A string needs quotes: --define 'NAME="feature"'
*/
