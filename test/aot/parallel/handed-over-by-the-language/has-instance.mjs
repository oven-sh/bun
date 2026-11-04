const seen = [];
class K { static [Symbol.hasInstance](value) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); return true; } }
K[Symbol.hasInstance](7);
"text" instanceof K; undefined instanceof K;
console.log(seen.join(" "));
