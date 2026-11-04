console.log("the file begins");
exports.second = 2;
const required = require("./module.mjs");
console.log("the file has the module", required.name);
console.log("the file ends");
