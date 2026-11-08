console.log("real begins");
exports.kind = typeof require("./plain.cjs");
console.log("real ends", exports.kind);
