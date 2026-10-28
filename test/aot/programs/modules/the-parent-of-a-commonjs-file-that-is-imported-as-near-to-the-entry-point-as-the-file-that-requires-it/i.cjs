const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("i", nameOf(module.parent));
