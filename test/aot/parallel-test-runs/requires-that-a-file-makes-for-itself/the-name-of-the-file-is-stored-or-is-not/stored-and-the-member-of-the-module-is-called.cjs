__filename = __dirname + "/inner/anchor.cjs";
require = require("node:module").createRequire(__filename);
module.exports = require("./which.cjs");
