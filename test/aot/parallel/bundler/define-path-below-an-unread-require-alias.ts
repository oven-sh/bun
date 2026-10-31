// A `--define` whose value is a dotted path is no use of the `import name = require(..)` that its first name is, and the build makes the variable of such an alias only where the file uses it: the build stops at the path.
// Flags: --define SEP=path.sep
import path = require("node:path");
declare const SEP: string;
console.log(typeof SEP);
/* Build errors:
error: TS100050: --aot does not support --define SEP=path.sep where "path" is an import that the file uses nowhere else. The value is read as a name. A string needs quotes: --define 'SEP="path.sep"'
*/
