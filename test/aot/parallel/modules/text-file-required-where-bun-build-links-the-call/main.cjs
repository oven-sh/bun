// Reference: bun build --compile
// `bun build` links these calls, and they answer the text. A path that nobody knows, elsewhere in the program, changes none of them.
console.log(JSON.stringify([require("./require.txt"), module.require("./module-require.txt")]));
require("./typed.cts");
require("./module.mjs");
if (process.argv.length > 9) console.log(require(process.argv[9]));
