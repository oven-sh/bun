let work = 0;
function describe() { for (let i = 0; i < 2; i++) work = (work + i) | 0; return this.l.deep; }
function call(o) { for (let i = 0; i < 2; i++) work = (work ^ i) | 0; return o.announce(); }
function peel(outer) { return outer.inner; }
function unwrap(box) { return box.item; }
const first = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: { deep: 12 }, announce: describe };
const second = { z: "x", announce: describe };
const crate = { inner: { item: second } };
let told; try { told = call(unwrap(peel(crate))); } catch (e) { told = e.constructor.name; }
console.log(call(first), told);
