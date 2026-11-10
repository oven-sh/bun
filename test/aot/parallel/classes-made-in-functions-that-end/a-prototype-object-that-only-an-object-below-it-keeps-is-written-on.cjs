"use strict";
const out = [];
function makeDrum(tag) {
  var skin = { text: "drum" + tag, rows: new Array(500).fill(tag) };
  function Drum(n) { this.n = n + skin.rows.length; }
  Drum.prototype.name = function () { return skin.text + ":" + this.n; };
  delete Drum.prototype.constructor;
  return Drum;
}
function askName(drum) { let text = ""; for (let i = 0; i < 200; i++) text = drum.name(); return text; }
let kept = (function () { const Drum = makeDrum(1); let last; for (let i = 0; i < 300; i++) last = new Drum(i); out.push(askName(last)); return last; })();
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    out.push(askName(kept));
    Object.getPrototypeOf(kept).name = function () { return "other:" + this.n; };
    out.push(askName(kept));
    delete Object.getPrototypeOf(kept).name;
    out.push(typeof kept.name);
    console.log(out.join());
  }, 2);
}, 2);
