// Behind `module.exports = X`, the names `exports` and top-level `this` still mean the first object, which no requirer sees: what is stored through them, ahead of the store or behind it, is not exported.
const f = require("./f.cjs");
console.log(f.lost, f.alsoLost, f.lostToo, f.kept, f());
const literal = require("./literal.cjs");
console.log(literal.a, literal.b);
