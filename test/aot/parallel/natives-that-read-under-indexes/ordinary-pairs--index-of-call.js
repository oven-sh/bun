const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const make = (k, v) => [first(k), second(v)];
const like = make(3, 4); like.length = 2;
try {
console.log(Array.prototype.indexOf.call(like, "V4!"), Array.prototype.includes.call(like, "K3"), Array.prototype.lastIndexOf.call(like, "K3"));
} catch (error) { console.log(error.constructor.name); }
