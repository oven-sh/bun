console.log("file begins");
exports.early = 1;
require("./imports-back.mjs");
module.exports = function replaced() {};
module.exports.late = 2;
console.log("file ends");
