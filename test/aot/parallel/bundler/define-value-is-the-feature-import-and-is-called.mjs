// `bun run` answers a call of `feature` of "bun:bundle" itself, also where a `--define` writes the name of the import in front of the arguments: the global of that name is not called. The build stops at such a call.
// Flags: --define NAME=feature
import { feature } from "bun:bundle";
globalThis.feature = () => "the global was called";
console.log(NAME("SUPER_SECRET") ? "on" : "off");
/* Build errors:
error: TS100050: --aot does not support --define NAME=feature where NAME is called. The value is read as a name. A string needs quotes: --define 'NAME="feature"'
*/
