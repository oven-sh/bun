exports.a = "half";
require("./below.cjs");
exports.a = "whole";
console.log("lib", exports.a, require("./lib.cjs").a);
