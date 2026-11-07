// Module.prototype._compile is read off require("node:module").prototype and never called.
const compile = require("node:module").prototype._compile;
console.log(typeof compile);
