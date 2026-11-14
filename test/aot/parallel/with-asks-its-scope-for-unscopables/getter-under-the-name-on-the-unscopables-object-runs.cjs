let hits = 0;
const scope = { y: 2, [Symbol.unscopables]: { get y() { hits++; return hits > 1; } } };
var y = "outer";
with (scope) { console.log(y); }
with (scope) { console.log(y); }
console.log(hits);
