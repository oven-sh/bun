exports.kind = "the first object";
exports.list = [1];
var d = require("./d");
module.exports = function replaced() {
  return "the function that replaced the object";
};
module.exports.kind = "the function";
module.exports.list = "not a list";
module.exports.d = d;
