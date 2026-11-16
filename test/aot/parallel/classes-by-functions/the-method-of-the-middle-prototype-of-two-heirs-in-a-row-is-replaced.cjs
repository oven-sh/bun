// The method of the middle prototype of two heirs in a row is replaced; the nearer prototype holds none of that name, then one, then none again.
"use strict";
function Base(a) { this.a = a; }
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
function Third(a) { Heir.call(this, a); this.c = 3; }
Third.prototype = new Heir(0);
Third.prototype.constructor = Third;
const turns = Number(process.argv[2] ?? 2000);
const second = function () { return 1000 + this.a; };
const third = function () { return 5000 + this.c; };
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Third(i & 7).area() + new Heir(i & 3).area()) | 0;
  console.log(name, sum);
}
run("as written");
Heir.prototype.area = second;
run("the middle one replaced");
Third.prototype.area = third;
run("the nearer one laid");
delete Third.prototype.area;
run("the nearer one deleted");
Object.setPrototypeOf(Third.prototype, { area() { return -1; } });
run("another object above the nearer one");
