const got = require("./plain.cjs");
console.log(Object.prototype.toString.call(got), Object.keys(got).length, Object.isExtensible(got));
