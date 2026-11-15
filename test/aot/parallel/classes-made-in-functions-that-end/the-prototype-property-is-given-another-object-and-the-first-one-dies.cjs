"use strict";
const out = [];
function makeFlag(tag) {
  var silk = { text: "flag" + tag, rows: new Array(500).fill(tag) };
  function Flag(n) { this.n = n + silk.rows.length; }
  Flag.prototype.name = function () { return silk.text + ":" + this.n; };
  return Flag;
}
const Flag = makeFlag(1);
out.push(new Flag(1).name());
Flag.prototype = { name: function () { return "second:" + this.n; } };
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    let last;
    for (let i = 0; i < 300; i++) last = new Flag(i);
    out.push(last.name(), last instanceof Flag, last.constructor === Object);
    console.log(out.join());
  }, 2);
}, 2);
