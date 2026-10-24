// The prototype property of a constructor function is replaced by a store and by definitions, at last by null, between constructions.
function Shape(n) { this.n = n; this.tag = "s"; }
Shape.prototype.area = function () { return this.n * 2; };
function make(n) { return new Shape(n); }
const out = [];
for (let i = 0; i < 9; i++) {
  if (i === 3) Shape.prototype = { area() { return this.n * 3; } };
  if (i === 5) Object.defineProperty(Shape, "prototype", { value: { area() { return this.n * 5; } } });
  if (i === 7) Object.defineProperty(Shape, "prototype", { value: null, writable: false });
  const s = make(i), r = Reflect.construct(Shape, [i]), t = Reflect.construct(Object, [], Shape);
  out.push([typeof s.area === "function" ? s.area() : "none", typeof r.area === "function" ? r.area() : "none", typeof t.area, s instanceof Object, Object.getPrototypeOf(s) === Shape.prototype, Object.getPrototypeOf(s) === Object.prototype, s.n + s.tag].join(" "));
}
console.log(out.join("\n"));
