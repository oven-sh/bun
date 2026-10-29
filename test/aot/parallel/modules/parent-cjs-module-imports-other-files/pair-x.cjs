const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.early = nameOf(module.parent);
exports.other = require("./pair-y.cjs").parent;
exports.late = nameOf(module.parent);
