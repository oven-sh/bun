const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const zero = 0, one = 1;
class Pair { constructor(k, v) { this.k = k; this.v = v; } get [zero]() { return first(this.k); } get [one]() { return second(this.v); } }
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
class Both { constructor(a, b) { this.all = [a, b]; } }
const out = Reflect.construct(Both, like).all;
let total = 0; for (const item of out) total += item === undefined ? -1000 : item.length;
console.log(out.length, total, out.map((item) => typeof item === "function" ? "function" : item).join());
} catch (error) { console.log(error.constructor.name); }
