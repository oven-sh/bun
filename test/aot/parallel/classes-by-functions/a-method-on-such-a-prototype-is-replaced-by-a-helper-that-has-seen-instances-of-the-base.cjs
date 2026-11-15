// The helper stores under the name on many plain instances of Base first, and then on the prototype of Heir.
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 2000);
const first = Heir.prototype.area;
const second = function () { return 1000 + this.a; };
const third = function () { return 5000 + this.b; };
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + new Heir(i & 7).area()) | 0;
  console.log(name, sum);
}
function lay(holder, method) { holder.area = method; }
let warmed = 0;
for (let i = 0; i < turns; i++) { const plain = new Base(i); lay(plain, i & 1 ? second : third); warmed = (warmed + plain.area()) | 0; }
console.log("warmed", warmed);
run("as written");
lay(Heir.prototype, second);
run("replaced by the helper");
lay(Heir.prototype, third);
run("and again");
