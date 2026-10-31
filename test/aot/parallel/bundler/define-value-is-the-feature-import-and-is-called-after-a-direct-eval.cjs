// Behind a direct `eval` of sloppy code a name that a `--define` writes is looked up when the code runs. `bun run` answers a call of the name of the `feature` import of "bun:bundle" itself there too, and the build stops at such a call.
// Flags: --define NAME=feature
import { feature } from "bun:bundle";
globalThis.feature = () => "the global was called";
function probe(text) {
  eval(text);
  return NAME("SUPER_SECRET") ? "on" : "off";
}
console.log(probe(""));
/* Build errors:
error: TS100050: --aot does not support --define NAME=feature where NAME is called. The value is read as a name. A string needs quotes: --define 'NAME="feature"'
*/
