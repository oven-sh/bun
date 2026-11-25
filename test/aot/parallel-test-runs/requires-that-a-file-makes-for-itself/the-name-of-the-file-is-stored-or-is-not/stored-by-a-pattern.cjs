const { createRequire } = require("node:module");
[__filename] = [__dirname + "/inner/anchor.cjs"];
require = createRequire(__filename);
module.exports = require("./which.cjs");
