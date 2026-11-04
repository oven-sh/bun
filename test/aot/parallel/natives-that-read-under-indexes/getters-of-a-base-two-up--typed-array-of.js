const first = (k) => k + 40;
const second = (v) => v + 50;
class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Middle extends Base { other() { return 1; } }
class Pair extends Middle { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
const out = new Uint8Array(like);
console.log(out.length, out[0] + out[1]);
} catch (error) { console.log(error.constructor.name); }
