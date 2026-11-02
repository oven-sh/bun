// A function under NaN is read from the namespace that require answers by a rest pattern.
const h = require("./other.mjs");
const { zzz, ...rest } = h;
const q = rest["NaN"];
console.log(g(q), g(() => 2));
function g(v) { return typeof v === "function" ? v() : typeof v; }
