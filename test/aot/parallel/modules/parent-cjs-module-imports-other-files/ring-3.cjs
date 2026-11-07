const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.early = nameOf(module.parent);
exports.below = require("./ring-2.cjs").below;
exports.late = nameOf(module.parent);
exports.kind = typeof module.parent + " " + !module.parent;
