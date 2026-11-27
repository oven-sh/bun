// Third.prototype is an instance of Heir, whose prototype is an instance of Base. Behind many births the middle one gets a setter, which the field of the nearer prototype hides from no store: a store looks at the nearest holder of the name.
"use strict";
function Base(a) { this.a = a; }
function Heir(a) { Base.call(this, a); this.b = 2; }
Heir.prototype = new Base(0);
Heir.prototype.constructor = Heir;
function Third(a) { Heir.call(this, a); this.c = 3; }
Third.prototype = new Heir(0);
Third.prototype.constructor = Third;
Third.prototype.area = function () { return this.a + this.b + this.c; };
const turns = Number(process.argv[2] ?? 2000);
const seen = [];
function run(name) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const made = new Third(i & 7);
    sum = (sum + made.area() + (Object.hasOwn(made, "a") ? 100 : 0) + (Object.hasOwn(made, "b") ? 1000 : 0)) | 0;
  }
  console.log(name, sum, seen.length, seen.slice(0, 3).join());
}
run("as written");
Object.defineProperty(Heir.prototype, "a", { get() { return 7; }, set(value) { seen.push(value); }, configurable: true });
run("a setter in the middle, hidden by the nearer field");
delete Third.prototype.a;
run("the nearer field deleted");
Object.defineProperty(Third.prototype, "b", { get() { return 70; }, set(value) { seen.push(-value); }, configurable: true });
run("a setter on the nearer prototype");
