exports.early = 1;
var first = exports;
function install(value) { exports = module.exports = value; exports.installed = true; return exports === module.exports; }
exports.install = install;
exports.same = function () { return [exports === module.exports, exports === first, this === exports]; };
module.exports.viaModule = 2;
