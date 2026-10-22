const b = require("./b.cjs");
exports.early = b.types();
exports.number = 1;
exports.string = "s";
exports.literal = { one: 1 };
exports.list = [1, 2];
exports.plain = function () {
  return 1;
};
exports.Class = class {};
