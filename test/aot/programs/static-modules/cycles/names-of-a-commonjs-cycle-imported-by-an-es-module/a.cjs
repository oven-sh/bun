exports.early = 1;
const b = require("./b.cjs");
exports.late = 2;
exports.bump = () => {
  exports.late++;
};
exports.b = b;
