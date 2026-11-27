// The prototype of Heir is an instance of Base, and an instance of Heir is the prototype of Third and hides the method of Heir. Sixteen instances of Heir are called at one place; then one of them gets a method of its own: a getter by object define property.
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
const made = [];
for (let i = 0; i < 16; i++) made.push(new Heir(i));
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + made[i & 15].area()) | 0;
  console.log(name, sum);
}
function hide(object, method) { Object.defineProperty(object, "area", { get() { return method; }, configurable: true }); }
run("as written");
for (let i = 0; i < turns; i++) hide(new Heir(i & 3), i & 1 ? second : third);
run("other instances have hidden it many times");
hide(made[5], second);
run("one of the sixteen hides it");
hide(made[9], third);
run("and another");
