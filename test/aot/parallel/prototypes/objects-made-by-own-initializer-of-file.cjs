// The initializer of `var shape` calls a function that reads `shape`: it finds undefined there.
var shape = { area() { return 7; }, unit: make(), name: "shape" };
function make() { return { __proto__: shape, side: 2 }; }
const { unit } = shape;
console.log(Object.getPrototypeOf(unit) === Object.prototype, typeof unit.area, typeof unit.toString, Object.keys(unit).join());
const late = make();
console.log(Object.getPrototypeOf(late) === shape, late.area(), late.name, Object.keys(late).join());
