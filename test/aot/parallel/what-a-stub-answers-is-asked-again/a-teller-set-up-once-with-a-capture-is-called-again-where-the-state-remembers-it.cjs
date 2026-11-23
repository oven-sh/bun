// The method is a closure with a capture, made once by a function that sets it up; the capture is laid among the variables, so the closure table holds the method without it. Where the walk remembers what the name found, the check asks the object again: for the function by its number, and makes no closure of its own.
// Flags: --aot-testing=CheckWalkAtRunTime
"use strict";
function Teller(lines) {
  this.lines = lines;
  this.at = 0;
  this.told = 0;
}
function setUp(limit, unit) {
  const over = limit * 2;
  Teller.prototype.next = function () {
    if (this.at >= this.lines.length) return unit + over;
    const at = this.at;
    this.at = at + 1;
    this.told = this.told + limit;
    return String(this.lines[at]) + unit;
  };
  Teller.prototype.skip = function (count) {
    this.at += count;
    return this.at > over ? -1 : this.at;
  };
  Teller.prototype.rest = () => unit + limit;
}
setUp(4, ";");
function read(teller, times) {
  let text = "";
  for (let turn = 0; turn < times; turn++) {
    text += teller.next();
    if (turn % 3 === 1) text += teller.skip(1) + teller.next();
    text += teller.rest().length;
  }
  return text;
}
function both(one, two) {
  const first = one.next() + one.next();
  const second = two.next() + one.next() + two.rest();
  return first + "|" + second;
}
for (let round = 0; round < 12; round++) {
  const teller = new Teller(["a", "bb" + round, "cccccc", "d", "eeeee", "f"]);
  const text = read(teller, 4);
  if (round % 5 === 0) console.log(text, teller.at, teller.told, both(new Teller(["x", "y"]), new Teller([])));
}
const own = new Teller(["p", "q"]);
own.next = function () {
  return "own" + this.at++;
};
console.log(read(own, 2), both(own, new Teller(["z"])));
setUp(1, "!");
console.log(read(new Teller(["gg", "hh", "ii"]), 2), both(own, new Teller(["z"])));
Teller.prototype.next = function () {
  Teller.prototype.next = () => "changed";
  return "once";
};
console.log(both(new Teller([]), new Teller([])), read(new Teller([]), 1));
delete Teller.prototype.skip;
try {
  read(new Teller([]), 3);
} catch (error) {
  console.log(error.constructor.name);
}
