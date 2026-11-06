// An object, a closure or an array is made in every round of a loop and handed to a function that keeps nothing, writes nothing and reads nothing that can change: it only asks what it was given.
// Each of these functions is a little too large to be expanded at its calls. Its answer hangs on a cell that is made anew in each round, though every other argument is the same in all rounds.
function mix(seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  return r & 7;
}

class Base {}
class Wider extends Base {}
class Other {}
function kindOf(node, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  r &= 7;
  return node instanceof Wider ? r + 100 : node instanceof Base ? r + 10 : node instanceof Other ? r + 1000 : -1000000;
}
let sum = 0;
for (let i = 0; i < 2000; i++) sum += kindOf(new Base(), 5);
console.log("an object without fields", sum);
sum = 0;
for (let i = 0; i < 2000; i++) sum += kindOf(new Wider(), 5);
console.log("of the class below", sum);
sum = 0;
for (let i = 0; i < 2000; i++) sum += kindOf(new Other(), 5);
console.log("of another class", sum);
sum = 0;
for (let i = 0; i < 2000; i++) sum += kindOf(new Base(), 5) + kindOf(new Other(), 5) + kindOf(new Wider(), 5);
console.log("three in one round", sum);
sum = 0;
for (let i = 0; i < 50; i++) for (let j = 0; j < 40; j++) sum += kindOf(new Other(), 5);
console.log("in the inner of two loops", sum);
sum = 0;
for (let i = 0; i < 2000; i++) if (i % 3) sum += kindOf(new Other(), 5);
console.log("in some rounds", sum);
console.log("none of them", kindOf({}, 5));

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class Size {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
function whichOf(pair, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  r &= 7;
  return pair instanceof Point ? r + 10 : pair instanceof Size ? r + 100 : -1000000;
}
function firstOf(pair, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  r &= 7;
  return pair instanceof Point ? r + pair.x : pair instanceof Size ? r + pair.y : -1000000;
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += whichOf(new Point(1, 2), 5) + whichOf(new Size(3, 4), 5);
console.log("objects with fields that nobody reads", sum);
sum = 0;
for (let i = 0; i < 2000; i++) sum += firstOf(new Point(10, 20), 5) + firstOf(new Size(300, 400), 5);
console.log("objects with fields that are read", sum);
console.log("neither", whichOf(null, 5), firstOf(undefined, 5));

function shapeOf(record, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  r &= 7;
  return "kind" in record ? r + 10 : "sort" in record ? r + 100 : -1000000;
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += shapeOf({ kind: 1 }, 5) + shapeOf({ sort: 2 }, 5);
console.log("literals", sum, shapeOf({ neither: 3 }, 5));

function three() {
  return 3;
}
function callOf(make, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  return (r & 7) + make();
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += callOf(() => 40, 5) + callOf(() => 500, 5) + callOf(three, 5);
console.log("closures", sum);
const held = mix(9);
sum = 0;
for (let i = 0; i < 2000; i++) sum += callOf(() => held + 40, 5) + callOf(() => held + 500, 5);
console.log("closures over a variable", sum);

function lengthOf(list, seed) {
  let r = seed | 0;
  r = (Math.imul(r, 31) + (r >>> 1) + 7) | 0;
  r = (Math.imul(r, 33) + (r >>> 2) + 8) | 0;
  r = (Math.imul(r, 35) + (r >>> 3) + 9) | 0;
  r = (Math.imul(r, 37) + (r >>> 4) + 10) | 0;
  r = (Math.imul(r, 39) + (r >>> 5) + 11) | 0;
  return (r & 7) + list.length * 10 + list[1];
}
sum = 0;
for (let i = 0; i < 2000; i++) sum += lengthOf([1, 200, 3], 5) + lengthOf([4, 5000], 5);
console.log("arrays", sum);
