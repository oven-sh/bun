console.log("hub starts");
exports.stage = 1;
exports.left = require("./left.cjs");
exports.stage = 2;
exports.right = require("./right.cjs");
exports.stage = 3;
console.log("hub ends");
