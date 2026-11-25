// One store under the name sees objects of many shapes first, so that it goes by the general road; then it replaces the method on the prototype of Heir, time and again.
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
const shapes = [];
for (let i = 0; i < 40; i++) { const one = { area: first }; one["extra" + i] = i; shapes.push(one); }
for (let i = 0; i < turns; i++) lay(shapes[i % 40], i & 1 ? second : third);
run("as written");
let sum = 0;
for (let i = 0; i < turns; i++) { lay(shapes[i % 40], first); lay(Heir.prototype, i & 1 ? second : third); sum = (sum + new Heir(i & 7).area()) | 0; }
console.log("in turns", sum);
