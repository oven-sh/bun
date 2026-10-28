const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("f begins", nameOf(module.parent));
require("./g.cjs");
console.log("f ends");
