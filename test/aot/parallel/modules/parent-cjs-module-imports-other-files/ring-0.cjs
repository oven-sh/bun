const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
const last = require("./ring-3.cjs");
exports.below = nameOf(module.parent) + " " + typeof last.late;
