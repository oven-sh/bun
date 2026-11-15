// A package is external by its name, and the program also requires its main file by a path.
// Flags: --external outside-package
const byName = require("outside-package");
console.log(typeof byName, byName && byName.who);
const byPath = require("./node_modules/outside-package/index.js");
console.log(typeof byPath, byPath && byPath.who);
