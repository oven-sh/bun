"use strict";
if (++globalThis.runs === 1) {
  exports.early = 1;
  throw new Error("first run");
}
module.exports = function late(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "late" + n; };
