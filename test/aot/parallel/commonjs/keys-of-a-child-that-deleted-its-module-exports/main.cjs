// `delete module.exports` takes the name off the module object. Whoever reaches the object by another way than `module` looks for it there.
console.log(typeof require("./lib.cjs"));
console.log(Object.keys(module.children[0]).join(), typeof require("./lib.cjs"));
