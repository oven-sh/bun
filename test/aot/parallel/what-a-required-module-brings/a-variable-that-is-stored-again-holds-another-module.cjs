let held = require("node:path");
function ask() {
  return typeof held.sep + " " + typeof held.EOL;
}
console.log(ask());
held = require("node:os");
console.log(ask());
