// The prototype of Heir is an instance of Base, and an instance of Heir is the prototype of Third. The prototype of Third itself, which holds a method of its own, is called at the place where instances of Heir are called; and an instance that got its own method loses it again.
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
run("as written");
made[3] = Third.prototype;
run("the prototype of Third among them");
made[7].area = second;
run("one hides it");
delete made[7].area;
run("and hides it no more");
made[7].other = 1;
run("another name beside the fields");
