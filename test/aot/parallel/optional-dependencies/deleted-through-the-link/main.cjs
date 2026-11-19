// `delete tools?.name`
const no = JSON.parse("false");
const yes = JSON.parse("true");
if (no) {
  var absent = require("./tools.mjs");
}
if (yes) {
  var present = require("./spare.mjs");
}
console.log(delete absent?.name, delete absent?.["nope"], delete present?.nope);
console.log(absent?.name, present?.name);
