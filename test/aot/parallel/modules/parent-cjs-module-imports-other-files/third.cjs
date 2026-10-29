const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./second.cjs");
exports.parent = () => nameOf(module.parent);
exports.children = () => module.children.map(nameOf).join();
