const a = require("./a.cjs");
exports.value = "c";
try {
  exports.sawVar = a.useVar();
} catch (error) {
  exports.sawVar = error.constructor.name;
}
