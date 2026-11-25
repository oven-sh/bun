// Classes that extend each other in rings escape, are constructed, and are asked for methods and setters, beside a read of a path that is stored again
"use strict";
const fs = require("fs"), path = require("path");
let file = path.join(__dirname, "first-of-none.txt");
if (process.argv.length > 9) file = path.join(__dirname, "second-of-none.txt");
const tell = make => {
  try {
    console.log(make());
  } catch (error) {
    console.log(error.name);
  }
};
tell(() => {
  class First extends Second { first() { return 1; } }
  class Second extends First { second() { return 2; } }
  return [First, Second];
});
tell(() => {
  class First extends Second { one = 1; }
  class Second extends Third { two = 2; }
  class Third extends First { three = 3; }
  return new First().one;
});
tell(() => {
  class First extends Second { constructor() { super(); this.one = 1; } }
  class Second extends First { set file(file) { this.kept = file; } }
  const made = new First();
  made.name = file;
  return made.name;
});
tell(() => {
  const First = class extends Second {};
  const Second = class extends First {};
  return new First("./none.mjs");
});
class Node { constructor(depth) { this.next = depth > 0 ? new Node(depth - 1) : null; } }
let depth = 0;
for (let node = new Node(40); node; node = node.next) depth++;
console.log(depth);
class Endless { next = new Endless(); }
tell(() => new Endless().next);
exports.load = () => fs.readFileSync(file, "utf8");
class Ring extends (exports.Base ?? Object) {}
exports.Ring = Ring;
exports.make = () => {
  class Left extends Right { left() { return 1; } }
  class Right extends Left { right() { return 2; } }
  exports.keep(Left, new Right());
};
try {
  exports.load();
} catch (error) {
  console.log(error.code);
}
tell(() => exports.make());
