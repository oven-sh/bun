const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.below = nameOf(module.parent) + " " + require("./ring-1.cjs").below;
