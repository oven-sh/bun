// The parent of a child is a module object, and its require() loads a file of the program.
const shelf = require("./shelf.cjs");
const box = require("./box.cjs");
const back = module.children[0].parent;
console.log(shelf.two, back === module, back.require("./box.cjs") === box);
