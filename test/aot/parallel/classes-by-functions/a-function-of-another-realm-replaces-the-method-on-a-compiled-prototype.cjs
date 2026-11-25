// The prototype of Heir is an instance of Base. A function made in another realm replaces the method of another instance of Base with the same names many times, and then the method of the prototype of Heir, by name and under a key.
"use strict";
const vm = require("node:vm");
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 2000);
const second = function () { return 1000 + this.a; };
const third = function () { return 5000 + this.a; };
const spare = new Base(0);
spare.constructor = Heir;
spare.area = third;
const below = Object.create(spare);
const byName = vm.runInNewContext("(function (holder, method) { holder.area = method; })");
const byKey = vm.runInNewContext("(function (holder, key, method) { holder[key] = method; })");
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Heir(i & 7).area()) | 0;
  console.log(name, sum, below.area.call({ a: 1 }));
}
run("as written");
for (let i = 0; i < turns; i++) { byName(spare, i & 1 ? second : third); byKey(spare, "area", i & 1 ? third : second); }
run("the other one replaced many times");
byName(Heir.prototype, second);
run("by name");
byKey(Heir.prototype, "area", third);
run("under a key");
