// A `--define` whose value is `module` is the module object of the file: its `children`, `id`, `loaded` and `parent` are read below the defined name.
// Flags: --define M=module
require("./lib.cjs");
console.log(M.children.length, M.id, M.loaded, typeof M.parent);
