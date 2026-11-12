console.log("real");
exports.present = 1;
exports.load = () => [require("./plain.cjs"), require("./other.cjs")];
