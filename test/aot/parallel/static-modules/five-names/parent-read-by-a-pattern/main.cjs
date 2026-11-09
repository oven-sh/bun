// `const { parent } = module` reads what `module.parent` reads. The file that requires the reader is read by names alone, so nothing else makes the compiler keep an object for it.
const { x } = require("./requirer.cjs");
console.log(x);
