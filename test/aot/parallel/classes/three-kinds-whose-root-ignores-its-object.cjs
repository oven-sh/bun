// new Root() is a prototype that the build follows, although Root only hands its arguments to a method that does nothing with its object.
// STATISTIC: OperationsSwept <= 2000
"use strict";
var Yard = {};
Yard.Root = function () {
  this.open.apply(this, arguments);
};
Yard.Root.prototype.open = function () {};
Yard.Root.prototype.cost = function () {
  return 1;
};
Yard.Plank = function (length) {
  this.length = length;
};
Yard.Plank.prototype = new Yard.Root();
Yard.Plank.prototype.cost = function () {
  return this.length * 2;
};
Yard.Beam = function (length, depth) {
  this.length = length;
  this.depth = depth;
};
Yard.Beam.prototype = new Yard.Plank(0);
Yard.Beam.prototype.weight = function () {
  return this.cost() * this.depth;
};
let sum = 0;
for (let at = 0; at < 3000; at++) {
  const plank = new Yard.Plank(at & 7);
  const beam = new Yard.Beam(at & 15, 3);
  sum = (sum + plank.cost() + beam.weight()) | 0;
}
console.log(sum);
