console.log("lib begins");
exports.first = 1;
const main = require("./main.mjs");
console.log("lib: required", Object.keys(main).join(), main.own);
console.log("lib ends");
