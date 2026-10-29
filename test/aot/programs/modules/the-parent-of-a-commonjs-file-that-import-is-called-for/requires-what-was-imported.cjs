const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./imported-earlier.cjs");
exports.children = () => module.children.map(nameOf).join();
