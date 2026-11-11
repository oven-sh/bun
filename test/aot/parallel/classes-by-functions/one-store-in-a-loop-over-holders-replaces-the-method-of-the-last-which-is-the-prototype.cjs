// The prototype of Heir is an instance of Base. Another instance of Base with the same names is the prototype of an object that no constructor makes; both have been read by one read, so they have one shape. One store in one loop goes over a list of holders: the other one many times, and last the prototype of Heir.
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
const holders = [];
for (let i = 0; i < turns; i++) holders.push(spare);
holders.push(Heir.prototype);
for (let i = 0; i < holders.length; i++) lay(holders[i], i & 1 ? third : second);
run("the last of the list was the prototype of Heir");
holders.push(Heir.prototype);
for (let i = 0; i < holders.length; i++) lay(holders[i], i & 1 ? third : second);
run("and again");
