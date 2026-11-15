const { createRequire } = require("node:module");
module.exports = createRequire(__filename)("./a.js");
