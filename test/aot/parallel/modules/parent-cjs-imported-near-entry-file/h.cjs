const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("h begins", nameOf(module.parent));
require("./i.cjs");
console.log("h ends");
