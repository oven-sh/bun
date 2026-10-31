// Of `(0, NAME)()` `bun run` prints what a `--define` gives NAME alone in front of the arguments, and it answers the call itself where that is the name of the `feature` import of "bun:bundle". The build stops at such a call.
// Flags: --define NAME=feature
import { feature } from "bun:bundle";
globalThis.feature = () => "the global was called";
console.log((0, NAME)("SUPER_SECRET") ? "on" : "off");
/* Build errors:
error: TS100050: --aot does not support --define NAME=feature where NAME is called. The value is read as a name. A string needs quotes: --define 'NAME="feature"'
*/
