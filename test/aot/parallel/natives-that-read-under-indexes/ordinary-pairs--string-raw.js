const first = (k) => "K" + k;
const second = (v) => "V" + v + "!";
const make = (k, v) => [first(k), second(v)];
const like = make(3, 4); like.length = 2;
try {
const text = String.raw({ raw: like }, "+");
console.log(text.length > 40 ? "functions" : text);
} catch (error) { console.log(error.constructor.name); }
