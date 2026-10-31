// A store, an update and `delete` through a defined name whose `--define` value is a path below `module.parent` change a member of the module object of the file that requires the file that the name is written in.
// Flags: --define COUNT=module.parent.count --define process.env.REMOVED=module.parent.removed
module.removed = "a member of the module object";
const lib = require("./lib.cjs");
console.log(module.count, lib.removed, "removed" in module);
