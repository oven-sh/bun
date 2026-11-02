// A `--define` whose value is `module.parent` is, in a required file, the module object of the file that requires it.
// Flags: --define PARENT=module.parent
require("./lib.cjs");
