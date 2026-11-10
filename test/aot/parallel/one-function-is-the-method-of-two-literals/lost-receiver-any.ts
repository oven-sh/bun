function describe(this: any) { return this.badge; }
function call(o: any) { return o.announce(); }
function peel(outer: any) { return outer.inner; }
function unwrap(box: any) { return box.item; }
const first = { badge: 1, announce: describe, alpha: 0 };
const second = { beta: "x", gamma: "y", badge: "two", announce: describe };
const crate = { inner: { item: second } };
console.log(call(first), call(unwrap(peel(crate))));
