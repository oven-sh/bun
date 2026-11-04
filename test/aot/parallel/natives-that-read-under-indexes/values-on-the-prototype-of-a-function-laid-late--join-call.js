const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
function Pair(k, v) { this.k = k; this.v = v; }
const make = (k, v) => new Pair(k, v);
function late() { Pair.prototype[0] = first(7); Pair.prototype[1] = second(7); }
late();
const like = make(3, 4); like.length = 2;
try {
const text = Array.prototype.join.call(like, "-");
console.log(text.length > 40 ? "functions" : text);
} catch (error) { console.log(error.constructor.name); }
