// A package marked --external is interpreted. It puts a getter on the object above every module object, and a file of the program reads that name
// off its own `module`: the getter gets the module object, and through it what the file exports.
// Flags: --external outside-package
const inner = require("./inner.cjs");
const replaceWhatWasCaught = require("outside-package");
console.log(inner.isHot());
console.log(replaceWhatWasCaught());
console.log(inner.secret());
