"use strict";
// The helper requires this module while its body runs, so it meets the first exports object.
function look() {
  const seen = require("./cycle.cjs");
  return [typeof seen, Object.keys(seen).join(), seen === module.exports, typeof seen.kInside].join(" ");
}
const early = look();
module.exports = { kInside: Symbol("inside"), early, late: look };
