const { createRequire } = require("node:module");
arguments[3] = __dirname + "/inner/anchor.cjs";
require = createRequire(__filename);
module.exports = require("./which.cjs");
