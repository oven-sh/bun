"use strict";
const out = [];
function makePair(tag) {
  var clay = { text: "root" + tag, rows: new Array(500).fill(tag) };
  class Root { constructor(n) { this.n = n + clay.rows.length; } name() { return clay.text + ":" + this.n; } }
  class Twig extends Root { constructor(n) { super(n); this.m = n; } both() { return super.name() + ":" + this.m; } }
  return Twig;
}
function useOnce(tag) {
  const Twig = makePair(tag);
  let last;
  for (let i = 0; i < 300; i++) last = new Twig(i);
  out.push(last.both(), last instanceof Twig, Object.getPrototypeOf(Twig.prototype).constructor === Object.getPrototypeOf(Twig));
}
useOnce(1);
setTimeout(() => {
  Bun.gc(true);
  setTimeout(() => {
    Bun.gc(true);
    useOnce(2);
    Bun.gc(true);
    useOnce(3);
    console.log(out.join());
  }, 2);
}, 2);
