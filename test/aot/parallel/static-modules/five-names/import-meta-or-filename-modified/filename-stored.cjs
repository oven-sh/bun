const { createRequire } = require("node:module");
__filename = __dirname + "/other/x.cjs";
module.exports = createRequire(__filename)("./a.js");
