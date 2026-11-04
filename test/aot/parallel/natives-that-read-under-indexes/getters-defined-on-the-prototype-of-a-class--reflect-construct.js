const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
class Pair { constructor(k, v) { this.k = k; this.v = v; } }
Object.defineProperties(Pair.prototype, { 0: { get() { return first(this.k); } }, 1: { get() { return second(this.v); } } });
const make = (k, v) => new Pair(k, v);
const like = make(3, 4); like.length = 2;
try {
class Both { constructor(a, b) { this.all = [a, b]; } }
const out = Reflect.construct(Both, like).all;
let total = 0; for (const item of out) total += item === undefined ? -1000 : item.length;
console.log(out.length, total, out.map((item) => typeof item === "function" ? "function" : item).join());
} catch (error) { console.log(error.constructor.name); }
