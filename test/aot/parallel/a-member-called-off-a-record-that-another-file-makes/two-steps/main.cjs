var lib = require("./lib.cjs");
globalThis.kept = lib;
var add = lib.add;
var Point = lib.Point;
function sums(t) { let s = t & 1; for (let i = 0; i < 100; i++) s = s + (add(i, t) + new Point(i).x) | 0; return s >>> 0; }
console.log(sums(3), sums(4), new Point(21) instanceof lib.Point);
