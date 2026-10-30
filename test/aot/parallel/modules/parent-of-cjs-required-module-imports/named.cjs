const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.early = nameOf(module.parent);
exports.parent = () => nameOf(module.parent);
