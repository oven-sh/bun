console.log("file begins");
exports.early = { first: 1 };
require("./imports-back.mjs");
console.log("file ends");
