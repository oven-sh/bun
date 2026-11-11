// module.children goes to a function as an argument, and the require() of what it holds loads a file of the program.
const shelf = require("./shelf.cjs");
const box = require("./box.cjs");
const ask = list => list[0].require("./box.cjs");
console.log(shelf.two, ask(module.children) === box);
