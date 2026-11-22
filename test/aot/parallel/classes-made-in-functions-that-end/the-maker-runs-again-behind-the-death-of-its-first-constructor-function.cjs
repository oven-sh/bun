"use strict";
const out = [];
function makeShelf(tag) {
  var label = { text: "shelf" + tag, rows: new Array(500).fill(tag) };
  function Shelf(n) { this.n = n + label.rows.length; }
  Shelf.prototype.name = function () { return label.text + ":" + this.n; };
  return Shelf;
}
function useOnce(tag) {
  const Shelf = makeShelf(tag);
  let last = null;
  for (let i = 0; i < 300; i++) last = new Shelf(i);
  out.push(last.name(), last instanceof Shelf, Object.getPrototypeOf(last) === Shelf.prototype, last.constructor === Shelf);
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
