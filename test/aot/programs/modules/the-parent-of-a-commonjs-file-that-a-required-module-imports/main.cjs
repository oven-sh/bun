const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./requires-the-next.mjs");
require("./requires-the-one-before.mjs");
const names = require("./takes-names.mjs");
const file = require("./named.cjs");
console.log("named", names.early, file.early, file.parent());
console.log("main", nameOf(module.parent), module.children.map(nameOf).join());
