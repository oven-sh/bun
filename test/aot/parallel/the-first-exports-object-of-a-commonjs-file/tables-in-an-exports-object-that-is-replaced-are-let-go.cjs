"use strict";
const refs = [], out = [];
for (let k = 0; k < 10; k++) {
  (function (exports) {
    var table = { rows: new Array(2000).fill(k) };
    refs.push(new WeakRef(table));
    exports["table" + k] = table;
    out.push(table.rows.length + k);
  })(exports);
}
module.exports = {};
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const gone = refs.filter(ref => ref.deref() === undefined).length;
    console.log(out.join(), gone >= 8 ? "let go" : "kept: " + (refs.length - gone));
  }, 5);
}, 5);
