const first = (k) => k + 40;
const second = (v) => v + 50;
const zero = 0, one = 1;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get [zero]() { return first(this.k); } get [one]() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
const out = new Uint8Array(like);
console.log(out.length, out[0] + out[1]);
} catch (error) { console.log(error.constructor.name); }
