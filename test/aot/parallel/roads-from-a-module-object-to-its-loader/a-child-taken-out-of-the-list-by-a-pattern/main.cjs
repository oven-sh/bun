// A pattern takes a module object out of module.children, and its require() loads a file of the program.
const shelf = require("./shelf.cjs");
const box = require("./box.cjs");
const [first] = module.children;
console.log(shelf.two, first.require("./box.cjs") === box);
