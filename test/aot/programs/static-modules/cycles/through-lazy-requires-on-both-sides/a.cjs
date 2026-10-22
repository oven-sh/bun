exports.getB = () => require("./b.cjs");
exports.value = "a";
exports.fromB = exports.getB().fromA;
