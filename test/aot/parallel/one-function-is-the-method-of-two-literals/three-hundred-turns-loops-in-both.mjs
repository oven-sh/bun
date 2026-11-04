let work = 0;
function describe() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.badge; }
function call(o) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; return o.announce(); }
function peel(outer) { return outer.inner; }
function unwrap(box) { return box.item; }
const first = { badge: 1, announce: describe, alpha: 0 };
const second = { beta: "x", gamma: "y", badge: "two", announce: describe };
const crate = { inner: { item: second } };
let out = ''; for (let i = 0; i < 300; i++) out = call(first) + ' ' + call(unwrap(peel(crate)));
console.log(out);
