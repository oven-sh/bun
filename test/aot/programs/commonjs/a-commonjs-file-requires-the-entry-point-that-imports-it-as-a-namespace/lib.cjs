console.log("lib begins");
exports.first = 1;
const main = require("./main.mjs");
console.log("lib: required", Object.keys(main).join(), main.own);
exports.second = 2;
console.log("lib ends");
