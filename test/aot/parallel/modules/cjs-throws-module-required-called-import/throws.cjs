console.log("throws begins");
exports.first = 1;
require("./imports-back.mjs");
exports.second = 2;
throw new RangeError("half-way");
