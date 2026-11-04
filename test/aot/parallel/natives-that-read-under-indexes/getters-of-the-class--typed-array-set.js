const first = (k) => k + 40;
const second = (v) => v + 50;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get 0() { return first(this.k); } get 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
const out = new Uint8Array(2); out.set(like);
console.log(out.length, out[0] + out[1]);
} catch (error) { console.log(error.constructor.name); }
