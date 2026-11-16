// A CommonJS module is required twice, whole and by a pattern; module.id, __filename and require.main of the entry point.
// Alone: it asks which file the executable was started as (import.meta.main, require.main, module.id, module.parent, process.argv[1])
const helper = require("./commonjs-helper.js");
const { twice } = require("./commonjs-helper.js");
console.log(helper.name, twice(21), module.id === ".", typeof __filename, require.main === module);
exports.done = true;
