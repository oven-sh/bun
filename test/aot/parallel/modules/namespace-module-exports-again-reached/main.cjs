// Reaches the `module.exports` of a CommonJS file through require() of an ES module that exports the namespace of another ES module under a name.
console.log(require("./lib.mjs").outer.default.c);
console.log(require("./lib.mjs").outer.default(), typeof require("./lib.mjs").outer.missing);
console.log(require("./top.mjs").outermost.outer.default.c, Object.keys(require("./top.mjs").outermost).join());
var held = require("./lib.mjs").outer.default;
console.log(held.b, Reflect.deleteProperty(held, "c"), held.c, require("./lib.mjs").outer.default.c);
