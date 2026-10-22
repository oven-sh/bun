exports.getA = () => require("./a.cjs");
exports.value = "b";
exports.fromA = exports.getA().value + ":" + exports.getA().fromB;
