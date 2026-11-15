// The prototype of Heir is an instance of Base; `size` is found above it, on the prototype of Base. A helper that has exchanged the object above another instance of Base many times exchanges the object above the prototype of Heir.
"use strict";
function Base(a) { this.a = a; }
Base.prototype.size = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 2000);
const spare = new Base(0);
spare.constructor = Heir;
spare.area = function () { return 0; };
const below = Object.create(spare);
const others = [{ size() { return 1000 + this.a; } }, { size() { return 5000 + this.a; } }];
function raise(holder, above) { Object.setPrototypeOf(holder, above); }
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) { const made = new Heir(i & 7); sum = (sum + made.size() + 3 * made.area()) | 0; }
  console.log(name, sum, below.size.call({ a: 1 }));
}
run("as written");
for (let i = 0; i < turns; i++) raise(spare, others[i & 1]);
run("the object above the other one exchanged many times");
raise(Heir.prototype, others[0]);
run("the object above the prototype of Heir exchanged");
raise(Heir.prototype, others[1]);
run("and again");
raise(Heir.prototype, Base.prototype);
run("and put back");
