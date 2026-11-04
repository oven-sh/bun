const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => { const pair = Object.create(above); pair.k = k; pair.v = v; return pair; };
const like = make(3, 4); like.length = 2;
try {
const text = Array.prototype.join.call(like, "-");
console.log(text.length > 40 ? "functions" : text);
} catch (error) { console.log(error.constructor.name); }
