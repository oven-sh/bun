// The function that a written descriptor lays as the setter arrives there by twelve reads out of holders.
function put(next) { this.seen = next; }
const h1 = { v: put }, h2 = { v: h1 }, h3 = { v: h2 }, h4 = { v: h3 }, h5 = { v: h4 }, h6 = { v: h5 }, h7 = { v: h6 }, h8 = { v: h7 }, h9 = { v: h8 }, h10 = { v: h9 }, h11 = { v: h10 }, h12 = { v: h11 };
const first = { raw: 0 }, second = { low: 0, more: 1 };
Object.defineProperty(first, "value", { set: h12.v.v.v.v.v.v.v.v.v.v.v.v });
Object.defineProperty(second, "value", { set: put });
function touch(held, next) { held.value = next; return typeof held.seen; }
console.log(touch(first, 5), touch(second, 6), typeof first.seen, typeof second.seen);
