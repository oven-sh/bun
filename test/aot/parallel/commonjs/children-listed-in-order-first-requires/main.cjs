// Children are listed in the order of the first requires.
const path = require("path");
const names = m => m.children.map(c => path.basename(c.id)).join("+");
console.log(names(module));
require("./a.cjs"); console.log(names(module));
require("./b.cjs"); require("./a.cjs"); console.log(names(module), names(module.children[0]), names(module.children[1]));
