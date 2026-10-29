const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("g", nameOf(module.parent));
exports.g = 1;
