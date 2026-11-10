// The prototype of Heir is an instance of Base. Another instance of Base with the same names is the prototype of an object that no constructor makes. Object.defineProperty with a value replaces the method of that one time and again, and then the method of the prototype of Heir. An instance of Heir is in turn the prototype of Third and holds a method of the same name, so one object of Heir hides the method of Heir.
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
function lay(holder, method) { Object.defineProperty(holder, "area", { value: method, writable: true, enumerable: true, configurable: true }); }
run("as written");
for (let i = 0; i < turns; i++) lay(spare, i & 1 ? second : third);
run("the other one replaced many times");
lay(Heir.prototype, second);
run("the prototype of Heir replaced once, by the same call");
lay(Heir.prototype, third);
run("and again");
