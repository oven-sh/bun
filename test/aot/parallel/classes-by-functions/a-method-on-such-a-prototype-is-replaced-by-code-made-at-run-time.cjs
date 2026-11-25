// Code made at run time replaces the method, under the name and under a key, time and again.
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
const byName = new Function("holder", "method", "holder.area = method;");
const byKey = new Function("holder", "key", "method", "holder[key] = method;");
run("as written");
let sum = 0;
for (let i = 0; i < turns; i++) { byName(Heir.prototype, i & 1 ? second : third); sum = (sum + new Heir(i & 7).area()) | 0; }
console.log("by name", sum);
sum = 0;
for (let i = 0; i < turns; i++) { byKey(Heir.prototype, "area", i & 1 ? third : second); sum = (sum + new Heir(i & 7).area()) | 0; }
console.log("by key", sum);
