// STATISTIC: SpeculatedClassesOfInitializersIgnored >= 1
// What a method of a plan lays on an object that it is applied to tells nothing of other objects that bear these names.
"use strict";
const plan = (function () {
  const made = {};
  made.prepare = function (clay, heat, shelves) {
    this.clay = clay;
    this.heat = heat;
    this.shelves = shelves;
  };
  made.describe = function () {
    return this.clay + this.heat + this.shelves;
  };
  return made;
})();
function firing(order) {
  const kiln = Object.create(plan);
  kiln.prepare.apply(kiln, [order.clay, order.heat, 3]);
  return kiln;
}
function warmth(kilns) {
  let sum = 0;
  for (let n = 0; n < kilns.length; n++) {
    const kiln = kilns[n];
    sum += kiln.heat * kiln.shelves + kiln.clay.length;
  }
  return sum;
}
const kilns = [];
for (let n = 0; n < 900; n++) kilns.push(firing({ clay: n & 1 ? "red" : "white", heat: n }));
console.log(warmth(kilns), kilns[7].describe());
kilns.push({ clay: "blue", heat: 2, shelves: 1 }, { shelves: 2, heat: 0.5, clay: ["a"] });
console.log(warmth(kilns));
const bare = {};
plan.prepare.apply(bare, ["grey", 4]);
kilns.push(bare);
console.log(Number.isNaN(warmth(kilns)), Object.keys(bare).join(), bare.shelves);
