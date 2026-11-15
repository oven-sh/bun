// A function of the file stores `module.exports` long behind its body, and then another file deletes `exports` on its module object: the delete is the later of the two, so require() answers nothing. The object itself says so already.
// Todo: "second" | "none": a wrong answer today: under `bun build --compile --aot` it prints "second", where `bun <file>` prints "none"
// `module.exports` in a file's own text is the program's variable, and the variable and the object are brought together at a require() alone: at the first look behind the delete nobody can tell which of the two came first, and the file is left as it was.
const lib = require("./lib.cjs");
const child = module.children[0];
require("./lib.cjs");
lib.set({ name: "second" });
delete child.exports;
const last = require("./lib.cjs");
console.log(last === undefined ? "none" : last.name, child.exports === undefined ? "none" : child.exports.name, "exports" in child);
