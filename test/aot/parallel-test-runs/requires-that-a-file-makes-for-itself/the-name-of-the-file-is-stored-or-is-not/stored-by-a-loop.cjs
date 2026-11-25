const { createRequire } = require("node:module");
for (__filename of [__dirname + "/inner/anchor.cjs"]);
require = createRequire(__filename);
module.exports = require("./which.cjs");
