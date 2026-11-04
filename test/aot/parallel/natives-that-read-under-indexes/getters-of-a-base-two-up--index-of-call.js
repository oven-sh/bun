const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Middle extends Base { other() { return 1; } }
class Pair extends Middle { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
console.log(Array.prototype.indexOf.call(like, "V4!"), Array.prototype.includes.call(like, "K3"), Array.prototype.lastIndexOf.call(like, "K3"));
} catch (error) { console.log(error.constructor.name); }
