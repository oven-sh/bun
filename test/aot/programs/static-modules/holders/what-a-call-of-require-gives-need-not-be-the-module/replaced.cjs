const real = require;
require = function () { return { a: "replaced" }; };
const m = require("./module.cjs");
console.log(m.a, real("./module.cjs").a);
