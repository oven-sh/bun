// A name that no code reads by name is listed through the module object of the child.
const a = require("./a.cjs");
console.log(a.used, Object.keys(module.children[0].exports).join());
