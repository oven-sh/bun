"use strict";
exports.early = 1;
const partner = require("./partner.cjs");
module.exports = { fresh: true };
exports.late = 2;
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    console.log(partner.read(), partner.isSame(module.exports), partner.isSame(exports), require("./partner.cjs") === partner);
  }, 2);
}, 2);
