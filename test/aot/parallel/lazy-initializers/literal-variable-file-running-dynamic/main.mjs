// An import() call that is made while a require() loads a graph is no part of that graph: what it names runs when the require() has returned. `bun run` takes the steps of the call inside the require().
// node has no require() in an ES module.
// Reference: bun build --compile
// A literal takes a variable of a file that is still running when an import call starts the file of the literal.
require("./middle.mjs");
export var count = 1;
