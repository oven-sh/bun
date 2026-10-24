// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {console.log("m's body runs");
exports.a = 1;
module.exports.b = require("./n.cjs").v;
})
