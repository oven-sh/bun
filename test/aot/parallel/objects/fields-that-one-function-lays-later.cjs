// One function stores all the fields that a constructor leaves out. Objects that it has not filled, has filled in part or twice, or whose fields change kind read as they should.
"use strict";
class Town {
  constructor(name, x, y) {
    this.name = name;
    this.x = x;
    this.y = y;
  }
}
function ready(town) {
  town.far = Infinity;
  town.cost = 0;
  town.done = false;
  town.by = null;
  town.roads = [];
  town.visits = 0;
}
function half(town) {
  town.far = 5;
  town.cost = 2;
}
function road(from, to) {
  from.roads.push(to);
  to.roads.push(from);
}
function walk(start) {
  const open = [start];
  start.far = 0;
  while (open.length) {
    let best = 0;
    for (let at = 1; at < open.length; at++) if (open[at].far < open[best].far) best = at;
    const town = open.splice(best, 1)[0];
    if (town.done) continue;
    town.done = true;
    town.visits++;
    for (const next of town.roads) {
      const far = town.far + Math.abs(town.x - next.x) + Math.abs(town.y - next.y);
      if (far < next.far) {
        next.far = far;
        next.by = town;
        next.cost = far * 2;
        open.push(next);
      }
    }
  }
}
function way(town) {
  const names = [];
  for (; town; town = town.by) names.push(town.name);
  return names.join("<");
}
for (let round = 0; round < 25; round++) {
  const towns = [];
  for (let at = 0; at < 12; at++) towns.push(new Town("t" + at, (at * 7 + round) % 13, (at * 5) % 11));
  for (const town of towns) ready(town);
  for (let at = 1; at < 12; at++) road(towns[at], towns[(at * 3 + round) % at]);
  walk(towns[0]);
  if (round % 8 === 0) console.log(round, towns.map(town => town.far + "/" + town.cost + "/" + town.visits).join(), way(towns[11]));
}
const show = town => Object.keys(town).join() + " | " + [town.far, town.cost, town.done, town.by, town.roads, town.visits].map(String).join();
const bare = new Town("bare", 1, 2);
console.log(show(bare), way(bare), "far" in bare);
const partly = new Town("partly", 1, 2);
half(partly);
console.log(show(partly), way(partly));
ready(partly);
console.log(show(partly));
half(partly);
ready(partly);
partly.visits = "often";
partly.done = 1;
partly.cost = { sum: 4 };
console.log(show(partly), partly.cost.sum, way(partly));
delete partly.by;
partly.far = undefined;
console.log(show(partly), way(partly));
try {
  road(bare, partly);
} catch (error) {
  console.log(error.constructor.name, show(bare), partly.roads.length);
}
const fixed = Object.freeze(new Town("fixed", 0, 0));
try {
  ready(fixed);
} catch (error) {
  console.log(error.constructor.name, show(fixed));
}
const other = {};
ready(other);
console.log(show(other), way(other));
Object.defineProperty(Town.prototype, "visits", { set(value) { this.told = "set " + value; }, get() { return 40; }, configurable: true });
const late = new Town("late", 3, 3);
ready(late);
console.log(show(late), late.told);
