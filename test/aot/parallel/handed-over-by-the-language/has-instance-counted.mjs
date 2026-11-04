const seen = [];
class K { static [Symbol.hasInstance](value) { seen.push("n:" + arguments.length); return true; } }
K[Symbol.hasInstance](7);
"text" instanceof K; undefined instanceof K;
console.log(seen.join(" "));
