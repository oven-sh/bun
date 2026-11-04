const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const above = { get 0() { return first(this.k); }, get 1() { return second(this.v); } };
const make = (k, v) => ({ __proto__: above, k, v });
const like = make(3, 4); like.length = 2;
try {
const text = String.raw({ raw: like }, "+");
console.log(text.length > 40 ? "functions" : text);
} catch (error) { console.log(error.constructor.name); }
