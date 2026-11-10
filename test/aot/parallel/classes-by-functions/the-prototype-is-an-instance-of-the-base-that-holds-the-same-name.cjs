// The prototype of Heir is an instance of Base, so it holds a plain `a` of its own. A store of `a` on a new Heir passes it and makes an own field.
"use strict";
function Base(a) { this.a = a; }
Base.prototype.area = function () { return this.a + 1; };
function Heir(a) { this.a = a; this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
Heir.prototype.area = function () { return this.a + this.b; };
const turns = Number(process.argv[2] ?? 2000);
const seen = [];
function make(i) {
  try {
    const made = new Heir(i & 7);
    return made.area() + (Object.hasOwn(made, "a") ? 100 : 0);
  } catch (error) {
    return -1000 - (error instanceof TypeError ? 1 : 0);
  }
}
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + make(i)) | 0;
  console.log(name, sum, seen.length, seen.slice(0, 3).join());
}
run("as written");
Heir.prototype.a = 50;
run("another value above");
delete Heir.prototype.a;
run("deleted above");
