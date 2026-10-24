const main = require("./main.cjs");
exports.sawEarly = main.early;
exports.sawLate = main.late;
exports.readLate = () => main.late;
exports.isSame = object => object === main;
