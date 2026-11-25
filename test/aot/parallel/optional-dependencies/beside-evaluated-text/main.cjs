// The program evaluates text, so nothing is closed.
const no = JSON.parse("false");
const yes = JSON.parse("true");
if (no) {
  var absent = require("./tools.mjs");
}
if (yes) {
  var present = require("./spare.mjs");
}
console.log((0, eval)("1 + 1"));
console.log(absent?.name, absent?.describe(), present?.name, present?.describe());
