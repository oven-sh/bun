// The literal with the setter arrives at the store by twelve reads out of holders, the other one straight.
function make(raw) { return { raw, set value(next) { this.seen = next; } }; }
const first = make(1), second = { low: 0, set value(next) { this.seen = next; } };
const h1 = { v: first }, h2 = { v: h1 }, h3 = { v: h2 }, h4 = { v: h3 }, h5 = { v: h4 }, h6 = { v: h5 }, h7 = { v: h6 }, h8 = { v: h7 }, h9 = { v: h8 }, h10 = { v: h9 }, h11 = { v: h10 }, h12 = { v: h11 };
function touch(held, next) { held.value = next; return typeof held.seen; }
console.log(touch(h12.v.v.v.v.v.v.v.v.v.v.v.v, 5), touch(second, 6), typeof first.seen, typeof second.seen);
