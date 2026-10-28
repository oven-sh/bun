const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("a begins", nameOf(module.parent));
require("./in-graph-b.cjs");
console.log("a ends");
