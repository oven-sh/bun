// The same under a key. Both methods have been read off their holders by one read many times before. An instance of Heir is in turn the prototype of Third and holds a method of the same name, so one object of Heir hides the method of Heir.
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
function Third(a) { this.a = a; this.b = 2; this.c = 3; }
Third.prototype = new Heir(0);
Third.prototype.constructor = Third;
Third.prototype.area = function () { return this.a + this.c; };
const turns = Number(process.argv[2] ?? 2000);
const second = function () { return 1000 + this.a; };
const third = function () { return 5000 + this.a; };
const spare = new Base(0);
spare.constructor = Heir;
spare.area = third;
const below = Object.create(spare);
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Heir(i & 7).area() + 7 * new Third(i & 3).area()) | 0;
  console.log(name, sum, below.area.call({ a: 1 }));
}
const keys = JSON.parse(`["area","area"]`);
function lay(holder, key, method) { holder[key] = method; }
function look(holder) { return holder.area; }
let looked = 0;
for (let i = 0; i < turns; i++) looked += look(i & 1 ? Heir.prototype : spare).length;
console.log("looked", looked);
run("as written");
for (let i = 0; i < turns; i++) lay(spare, keys[i & 1], i & 1 ? second : third);
run("the other one replaced many times");
lay(Heir.prototype, keys[0], second);
run("the prototype of Heir replaced once, by the same store");
