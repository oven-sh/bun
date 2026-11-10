// Another file deletes `exports` on the module object and stores it anew: an ordinary property now. The file reads its own `module.exports`, and nobody has required it since.
// Todo: "real" | "stored": a wrong answer today: under `bun build --compile --aot` it prints "real", where `bun <file>` prints "stored"
// `module.exports` in a file's own text is the program's variable, and the variable and the object are brought together at a require() alone.
const lib = require("./lib.cjs");
const child = module.children[0];
delete child.exports;
child.exports = { a: "stored" };
console.log(lib.read());
