// The parent of a commonjs file that a required module imports.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./requires-the-next.mjs");
require("./requires-the-one-before.mjs");
const names = require("./takes-names.mjs");
const file = require("./named.cjs");
console.log("named", names.early, file.early, file.parent());
console.log("main", nameOf(module.parent), module.children.map(nameOf).join());
