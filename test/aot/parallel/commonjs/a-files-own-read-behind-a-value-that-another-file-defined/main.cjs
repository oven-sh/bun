// The file reads its own `module.exports` behind a value that another file has defined on its module object, and nobody has required it since.
// Todo: "real" | "fake": a wrong answer today: under `bun build --compile --aot` it prints "real", where `bun <file>` prints "fake"
// `module.exports` in a file's own text is the program's variable, and the variable and the object are brought together at a require() alone.
const lib = require("./lib.cjs");
Object.defineProperty(module.children[0], "exports", { value: { a: "fake" } });
console.log(lib.read());
