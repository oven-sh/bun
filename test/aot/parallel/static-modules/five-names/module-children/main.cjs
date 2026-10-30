// `module.children` lists a module that was required twice once, and its `parent` is the requirer.
require("./a.cjs");
require("./a.cjs");
const c = module.children;
console.log(c.length, c[0].exports.x, c[0].parent === module);
