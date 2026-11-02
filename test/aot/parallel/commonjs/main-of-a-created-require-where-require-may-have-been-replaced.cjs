// A file that uses its own `arguments` could have replaced `require` through it, so the build does not take `require("node:module")` at its word.
// The `main` of a require made by createRequire() is still the entry file's module object. Nothing here names `module` or `require.main`.
const made = require("node:module").createRequire(__filename);
console.log(arguments.length, typeof made.main);
console.log(made.main === undefined);
console.log(typeof made.main.filename, made.main.filename === module.filename, made.main.loaded);
console.log(typeof require("node:module").createRequire("/somewhere/else.js").main);
