arguments[1] = function () { return { a: "mapped" }; };
const m = require("./module.cjs");
console.log(m.a);
