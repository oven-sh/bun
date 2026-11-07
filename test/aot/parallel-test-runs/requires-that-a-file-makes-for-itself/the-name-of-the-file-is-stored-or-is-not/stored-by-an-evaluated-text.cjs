const { createRequire } = require("node:module");
eval("__filename = __dirname + '/inner/anchor.cjs'");
require = createRequire(__filename);
module.exports = require("./which.cjs");
