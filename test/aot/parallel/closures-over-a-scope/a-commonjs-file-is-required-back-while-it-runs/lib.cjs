"use strict";
exports.read = read;
require("./back.cjs");
const held = { n: process.argv.length > 100 ? 5 : 1 };
function read() {
  return held.n;
}
