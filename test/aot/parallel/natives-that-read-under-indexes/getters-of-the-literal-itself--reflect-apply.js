const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const make = (k, v) => ({ k, v, get 0() { return first(this.k); }, get 1() { return second(this.v); } });
const like = make(3, 4); like.length = 2;
try {
const out = Reflect.apply((a, b) => [a, b], null, like);
let total = 0; for (const item of out) total += item === undefined ? -1000 : item.length;
console.log(out.length, total, out.map((item) => typeof item === "function" ? "function" : item).join());
} catch (error) { console.log(error.constructor.name); }
