const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("c", nameOf(module.parent));
exports.parent = () => nameOf(module.parent);
