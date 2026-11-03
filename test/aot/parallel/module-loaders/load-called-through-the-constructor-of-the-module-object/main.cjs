// module.constructor._load loads a file of the program for the module that asks.
const dep = module.constructor._load("./dep.cjs", module);
console.log(dep.name, dep.parent === module, require("./dep.cjs") === dep);
