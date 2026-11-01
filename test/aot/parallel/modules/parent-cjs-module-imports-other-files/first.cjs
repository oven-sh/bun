const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.parent = () => nameOf(module.parent);
