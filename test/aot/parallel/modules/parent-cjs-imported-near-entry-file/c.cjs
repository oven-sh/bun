const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("c begins", nameOf(module.parent));
require("./d.cjs");
require("./e.cjs");
console.log("c ends", module.children.map(nameOf).join());
exports.parent = () => nameOf(module.parent);
