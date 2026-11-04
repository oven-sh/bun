const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Base { get 0() { return first(this.k); } get 1() { return second(this.v); } }
class Middle extends Base { other() { return 1; } }
class Pair extends Middle { constructor(k, v) { super(); this.k = k; this.v = v; } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
const text = String.raw({ raw: like }, "+");
console.log(text.length > 40 ? "functions" : text);
} catch (error) { console.log(error.constructor.name); }
