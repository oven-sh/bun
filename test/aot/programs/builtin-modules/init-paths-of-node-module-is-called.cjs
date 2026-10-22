// Module._initPaths is a function of the library that does nothing. Whoever reads the property and calls it gets undefined.
const Module = require("node:module");
console.log(typeof Module._initPaths());
