const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("d begins", nameOf(module.parent));
console.log("d ends", require("./c.cjs").parent());
