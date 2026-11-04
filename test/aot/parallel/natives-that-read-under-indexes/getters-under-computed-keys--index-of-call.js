const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const zero = 0, one = 1;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get [zero]() { return first(this.k); } get [one]() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
console.log(Array.prototype.indexOf.call(like, "V4!"), Array.prototype.includes.call(like, "K3"), Array.prototype.lastIndexOf.call(like, "K3"));
} catch (error) { console.log(error.constructor.name); }
