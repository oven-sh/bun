// A `--define` whose value is a dotted path is a use of the `import name = require(..)` that has its first name, also where nothing else in the file reads the alias: the variable of the alias is made, and the path reads a member of the module.
// Flags: --define SEP=path.sep
import path = require("node:path");
declare const SEP: string;
console.log(typeof SEP);
