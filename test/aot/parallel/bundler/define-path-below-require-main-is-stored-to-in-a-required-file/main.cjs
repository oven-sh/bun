// A store, an update and `delete` through a defined name whose `--define` value is a path below `require.main` change a member of the module object of the file that the program starts with, also where the name is written in a file that it requires.
// Flags: --define COUNT=require.main.count --define process.env.REMOVED=require.main.removed
module.removed = "a member of the module object";
const lib = require("./lib.cjs");
console.log(module.count, lib.removed, "removed" in module);
