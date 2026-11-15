"use strict";
exports.rows = new Array(500).fill(3);
function readLater() { return exports.rows.length + ":" + exports.rows[0] + ":" + (exports === module.exports); }
module.exports = { fresh: true };
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    exports.more = 4;
    console.log(readLater(), exports.more, module.exports.more);
  }, 2);
}, 2);
