// Behind a delete both the file's own text and another file store `exports`, the other file last, and then the file is required: the later store is what require() answers.
// Todo: "own" | "foreign": a wrong answer today: under `bun build --compile --aot` it prints "own", where `bun <file>` prints "foreign"
// `module.exports` in a file's own text is the program's variable, and the variable and the object are brought together at a require() alone.
const lib = require("./lib.cjs");
const child = module.children[0];
delete child.exports;
lib.set({ a: "own" });
child.exports = { a: "foreign" };
console.log(require("./lib.cjs").a, child.exports.a);
