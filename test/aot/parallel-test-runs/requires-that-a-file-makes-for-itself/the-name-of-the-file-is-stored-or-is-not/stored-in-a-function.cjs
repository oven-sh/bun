const { createRequire } = require("node:module");
function move() {
  __filename = __dirname + "/inner/anchor.cjs";
}
move();
require = createRequire(__filename);
module.exports = require("./which.cjs");
