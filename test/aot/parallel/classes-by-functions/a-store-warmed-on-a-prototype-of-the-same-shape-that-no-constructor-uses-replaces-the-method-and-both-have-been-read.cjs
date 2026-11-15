// Another instance of the base holds the same names and is the prototype of an object that no constructor makes, so it has the shape of the prototype of Heir. One store replaces its method time and again, and then, once, the method of the prototype of Heir. Both methods have been read off their holders by one read many times before.
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
function lay(holder, method) { holder.area = method; }
function look(holder) { return holder.area; }
let looked = 0;
for (let i = 0; i < turns; i++) looked += look(i & 1 ? Heir.prototype : spare).length;
console.log("looked", looked);
run("as written");
for (let i = 0; i < turns; i++) lay(spare, i & 1 ? second : third);
run("the other one replaced many times");
lay(Heir.prototype, second);
run("the prototype of Heir replaced once, by the same store");
lay(Heir.prototype, third);
run("and again");
