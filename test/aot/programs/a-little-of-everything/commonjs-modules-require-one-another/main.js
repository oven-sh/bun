// A CommonJS module is required twice, whole and by a pattern; module.id, __filename and require.main of the entry point.
const helper = require("./commonjs-helper.js");
const { twice } = require("./commonjs-helper.js");
console.log(helper.name, twice(21), module.id === ".", typeof __filename, require.main === module);
exports.done = true;
