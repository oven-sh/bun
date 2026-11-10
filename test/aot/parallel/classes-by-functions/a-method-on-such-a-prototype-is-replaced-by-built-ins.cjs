// Object.assign, Object.defineProperty, Reflect.set and Reflect.defineProperty each replace the method.
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
run("as written");
Object.assign(Heir.prototype, { area: second });
run("Object.assign");
Object.defineProperty(Heir.prototype, "area", { value: third, writable: true, configurable: true, enumerable: true });
run("Object.defineProperty");
Reflect.set(Heir.prototype, "area", second);
run("Reflect.set");
Reflect.defineProperty(Heir.prototype, "area", { get() { return third; }, configurable: true });
run("a getter");
