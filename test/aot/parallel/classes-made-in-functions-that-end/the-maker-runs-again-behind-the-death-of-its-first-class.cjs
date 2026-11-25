"use strict";
const out = [];
function makeCrate(tag) {
  var label = { text: "crate" + tag, rows: new Array(500).fill(tag) };
  class Crate {
    constructor(n) { this.n = n + label.rows.length; }
    name() { return label.text + ":" + this.n; }
    static kind() { return "kind" + label.rows[0]; }
  }
  return Crate;
}
function useOnce(tag) {
  const Crate = makeCrate(tag);
  let last = null;
  for (let i = 0; i < 300; i++) last = new Crate(i);
  out.push(last.name(), Crate.kind(), last instanceof Crate, Object.getPrototypeOf(last) === Crate.prototype, last.constructor === Crate);
}
useOnce(1);
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    useOnce(2);
    useOnce(3);
    console.log(out.join());
  }, 2);
}, 2);
