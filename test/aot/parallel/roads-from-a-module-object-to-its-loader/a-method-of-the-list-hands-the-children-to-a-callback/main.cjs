// A method of module.children hands module objects to a callback, and their require() loads a file of the program.
const shelf = require("./shelf.cjs");
const box = require("./box.cjs");
console.log(shelf.two, module.children.map(child => child.require("./box.cjs") === box).join());
