const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("b", nameOf(module.parent));
