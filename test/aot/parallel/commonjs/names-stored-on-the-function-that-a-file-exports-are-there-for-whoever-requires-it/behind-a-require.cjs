var atTheHead = require("./at-the-head.cjs");
function behindARequire(a) {
  return atTheHead(a) + 1;
}
module.exports = behindARequire, module.exports.marker = true, module.exports["default"] = module.exports;
