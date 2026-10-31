// A `--define` whose value is `module.children` is the list of the module objects of the files that the file has required.
// Flags: --define KIDS=module.children
require("./lib.cjs");
console.log(KIDS.length);
