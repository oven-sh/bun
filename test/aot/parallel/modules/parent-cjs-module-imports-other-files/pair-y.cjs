const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./pair-x.cjs");
exports.parent = nameOf(module.parent);
