const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("a begins", nameOf(module.parent));
require("./b.cjs");
console.log("a ends", module.children.map(nameOf).join());
exports.parent = () => nameOf(module.parent);
