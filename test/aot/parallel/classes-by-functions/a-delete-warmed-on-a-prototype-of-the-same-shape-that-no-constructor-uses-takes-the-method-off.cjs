// The same by delete.
"use strict";
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
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Heir(i & 7).area()) | 0;
  console.log(name, sum, below.area.call({ a: 1 }));
}
function drop(holder) { delete holder.area; }
function lay(holder, method) { holder.area = method; }
run("as written");
for (let i = 0; i < turns; i++) { drop(spare); lay(spare, i & 1 ? second : third); }
run("the other one deleted and laid anew many times");
drop(Heir.prototype);
run("the method of the prototype of Heir deleted");
lay(Heir.prototype, third);
run("and laid anew");
