// `bun run` removes an `if` of the file that does nothing and forgets the names in it, so a `--define` whose value is one name is no use of the import of that name there: the import statement stays without the name, and its module runs and need not export the name. The build stops at the name.
// Flags: --define NAME=holder
import { holder } from "./lib.cjs";
declare const NAME: any;
if (NAME) {
}
console.log("end");
/* Build errors:
error: TS100050: --aot does not support --define NAME=holder where NAME is read. The value is read as a name. A string needs quotes: --define 'NAME="holder"'
*/
