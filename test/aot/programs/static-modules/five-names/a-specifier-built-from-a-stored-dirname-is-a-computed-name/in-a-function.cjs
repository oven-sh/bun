function move() {
  __dirname = __dirname + "/other";
}
move();
module.exports = require(__dirname + "/a.js");
