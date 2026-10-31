// `bun run` removes a statement that is one name and forgets the name, so a `--define` whose value is one name is no use of the import of that name there: the import statement stays without the name, which may be a type, and that file runs. The build stops at the name.
// Flags: --define NAME=Shape
import { Shape } from "./types";
declare const NAME: any;
NAME;
console.log("end");
/* Build errors:
error: TS100050: --aot does not support --define NAME=Shape where NAME is read. The value is read as a name. A string needs quotes: --define 'NAME="Shape"'
*/
