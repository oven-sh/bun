const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("e", nameOf(module.parent));
