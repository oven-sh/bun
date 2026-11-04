const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Pair { constructor(k, v) { this[0] = first(k); this.v = v; } get 1() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
console.log(Array.prototype.indexOf.call(like, "V4!"), Array.prototype.includes.call(like, "K3"), Array.prototype.lastIndexOf.call(like, "K3"));
} catch (error) { console.log(error.constructor.name); }
