// The file reads its own `module.exports` behind a value that another file has defined on its module object, and nobody has required it since.
// `module.exports` in a file's own text is the program's variable. A definition that gives `exports` a value reaches the setter of the module object,
// as a store does, and the setter writes the variable.
const lib = require("./lib.cjs");
Object.defineProperty(module.children[0], "exports", { value: { a: "fake" } });
console.log(lib.read());
