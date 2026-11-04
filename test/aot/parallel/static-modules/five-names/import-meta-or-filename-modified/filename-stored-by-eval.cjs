const { createRequire } = require("node:module");
eval('__filename = __dirname + "/other/x.cjs"');
module.exports = createRequire(__filename)("./a.js");
