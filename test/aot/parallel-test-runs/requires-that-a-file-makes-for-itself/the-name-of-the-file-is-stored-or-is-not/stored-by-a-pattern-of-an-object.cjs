const { createRequire } = require("node:module");
({ path: __filename } = { path: __dirname + "/inner/anchor.cjs" });
require = createRequire(__filename);
module.exports = require("./which.cjs");
