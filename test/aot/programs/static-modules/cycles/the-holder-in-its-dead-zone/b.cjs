const a = require("./a.cjs");
exports.value = "b";
try {
  exports.sawConst = a.useConst();
} catch (error) {
  exports.sawConst = error.constructor.name;
}
