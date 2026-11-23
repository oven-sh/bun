// An untyped package and a program of it (chains): iterators without generators: next, return, chained and lazy
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var R = lib.Range, L = lib.Lazy.of;
for (var i = 1; i < 14; i++) { var src = i % 3 === 0 ? 'lazy text ' + i : i % 3 === 1 ? new R(0, i * 4) : [i, 'x', null, [i, [2]], 3.5]; say(i, JSON.stringify(L(src).map(function (x) { return typeof x === 'number' ? x * i : x; }).toArray()), JSON.stringify(L(src).filter(function (x) { return x !== 'x'; }).take(i % 5 + 1).toArray()), JSON.stringify(L(src).drop(2).chunk(3).toArray()), JSON.stringify(L(src).chunk(2).flat().take(4).toArray()), R.closed); }
for (var x of new R(10, 0, -3)) { say(x); if (x < 5) break; } say(R.closed, Array.from(new R(0, 2, 0.5)).join(), Math.max.apply(null, [...new R(1, 9)]), L(new R(0, 1e9)).while(function (n) { return n * n < 50; }).toArray().join(), R.closed);
