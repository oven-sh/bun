// `new` of a value that holds a constructor function asks the run time for `this`. The quick road finds the words that such an object is born with through the structure it has remembered.
// A second prototype gives the same layout a second structure: its first birth goes the slow road and lays the way for the rest, as the first structure's did.
// COUNTER: ThisMadeBySlowOperation <= 400
"use strict";
function Point() {}
Point.prototype.norm = function () { return 5; };
function Pair() {}
Pair.prototype.norm = function () { return 7; };
function make(kind) { return new kind(); }
const kinds = JSON.parse(process.argv[3] || "[0,1,1,0]").map(function (which) { return [Point, Pair][which]; });
const turns = Number(process.argv[2] || 40000);
let sum = 0;
for (let turn = 0; turn < turns; turn++) {
  if (turn === turns >> 1) Point.prototype = { norm: function () { return 11; } };
  sum += make(kinds[turn & 3]).norm();
}
console.log(sum, Object.getPrototypeOf(make(Point)) === Point.prototype, make(Pair) instanceof Pair);
