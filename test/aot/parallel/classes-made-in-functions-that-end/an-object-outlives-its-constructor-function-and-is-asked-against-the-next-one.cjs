"use strict";
const out = [];
function makeLamp(tag) {
  var wires = { text: "lamp" + tag, rows: new Array(500).fill(tag) };
  function Lamp(n) { this.n = n + wires.rows.length; }
  Lamp.prototype.name = function () { return wires.text + ":" + this.n; };
  delete Lamp.prototype.constructor;
  return Lamp;
}
function askName(lamp) { return lamp.name(); }
let kept = (function () { const Lamp = makeLamp(1); let last; for (let i = 0; i < 300; i++) last = new Lamp(i); return last; })();
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    const Second = makeLamp(2);
    const other = new Second(7);
    out.push(kept instanceof Second, other instanceof Second, askName(kept), askName(other), Object.getPrototypeOf(kept) === Second.prototype, kept.constructor === Object);
    for (let i = 0; i < 300; i++) out[6] = askName(i & 1 ? kept : other);
    console.log(out.join());
  }, 2);
}, 2);
