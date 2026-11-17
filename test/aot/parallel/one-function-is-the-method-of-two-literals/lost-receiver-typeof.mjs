function describe() { return typeof this.badge; }
function call(o) { return o.announce(); }
function peel(outer) { return outer.inner; }
function unwrap(box) { return box.item; }
const first = { badge: 1, announce: describe, alpha: 0 };
const second = { beta: "x", gamma: "y", badge: "two", announce: describe };
const crate = { inner: { item: second } };
console.log(call(first), call(unwrap(peel(crate))));
