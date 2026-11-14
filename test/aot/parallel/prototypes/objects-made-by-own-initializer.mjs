// The initializer of `var shape` calls functions that read `shape`: they find undefined there.
function tell(made) {
  const prototype = Object.getPrototypeOf(made);
  const above = prototype === Object.prototype ? "Object.prototype" : typeof prototype.area;
  let area;
  try { area = made.area(); } catch (error) { area = error.constructor.name; }
  return [above, area, typeof made.toString, Object.keys(made).join("+")].join();
}
function attempt(make) {
  try { return tell(make()); } catch (error) { return error.constructor.name; }
}
const results = {
  call: (function () {
    var shape = { area() { return 7; }, unit: attempt(make) };
    function make() { return { __proto__: shape, side: 2 }; }
    return [shape.unit, attempt(make)];
  })(),
  create: (function () {
    var shape = { area() { return 7; }, unit: attempt(make) };
    function make() { return Object.create(shape); }
    return [shape.unit, attempt(make)];
  })(),
  setPrototypeOf: (function () {
    var shape = { area() { return 7; }, unit: attempt(make) };
    function make() { return Object.setPrototypeOf({ side: 2 }, shape); }
    return [shape.unit, attempt(make)];
  })(),
  getter: (function () {
    var source = { get unit() { return attempt(make); } }, shape = { area() { return 7; }, unit: source.unit };
    function make() { return { __proto__: shape, side: 2 }; }
    return [shape.unit, attempt(make)];
  })(),
  key: (function () {
    var first, source = { toString() { first = attempt(make); return "key"; } }, shape = { area() { return 7; }, [source]: 1 };
    function make() { return { __proto__: shape, side: 2 }; }
    return [first, attempt(make)];
  })(),
  sum: (function () {
    var first, source = { valueOf() { first = attempt(make); return 1; } }, shape = { area() { return 7; }, sum: source + 1 };
    function make() { return { __proto__: shape, side: 2 }; }
    return [first, shape.sum, attempt(make)];
  })(),
  spread: (function () {
    var shape = { area() { return 7; }, unit: [...walk()] };
    function* walk() { yield attempt(make); }
    function make() { return { __proto__: shape, side: 2 }; }
    return [shape.unit, attempt(make)];
  })(),
  tag: (function () {
    var shape = { area() { return 7; }, unit: tag`text` };
    function tag() { return attempt(make); }
    function make() { return { __proto__: shape, side: 2 }; }
    return [shape.unit, attempt(make)];
  })(),
  staticBlock: (function () {
    var first, shape = { area() { return 7; }, unit: class { static { first = attempt(make); } } };
    function make() { return { __proto__: shape, side: 2 }; }
    return [first, attempt(make)];
  })(),
  construct: (function () {
    var shape = { area() { return 7; }, unit: new Unit() };
    function Unit() { this.first = attempt(make); }
    function make() { return { __proto__: shape, side: 2 }; }
    return [shape.unit.first, attempt(make)];
  })(),
  declaredTwice: (function () {
    var shape;
    var first = attempt(make);
    var shape = { area() { return 7; } };
    function make() { return { __proto__: shape, side: 2 }; }
    return [first, attempt(make)];
  })(),
  declaredTwiceAndCreated: (function () {
    var shape;
    var first = attempt(make);
    var shape = { area() { return 7; } };
    function make() { return Object.create(shape); }
    return [first, attempt(make)];
  })(),
  assigned: (function () {
    var above = { area() { return 7; } }, shape = Object.assign(Object.create(above), { unit: attempt(make) });
    function make() { return Object.create(shape); }
    return [shape.unit, attempt(make)];
  })(),
  setter: (function () {
    var first, above = { area() { return 7; }, set unit(value) { first = attempt(make); } }, shape = Object.assign(Object.create(above), { unit: 1 });
    function make() { return Object.create(shape); }
    return [first, attempt(make)];
  })(),
  getterAssigned: (function () {
    var above = { area() { return 7; } }, shape = Object.assign(Object.create(above), { get unit() { return attempt(make); } });
    function make() { return Object.create(shape); }
    return [shape.unit, attempt(make)];
  })(),
  storedPrototype: (function () {
    var shape = { area() { return 7; }, unit: attempt(make) };
    function Made() { this.side = 2; }
    function make() { Made.prototype = shape; return new Made(); }
    return [shape.unit, attempt(make)];
  })(),
  constant: (function () {
    let first;
    const shape = { area() { return 7; }, unit: first = attempt(make) };
    function make() { return { __proto__: shape, side: 2 }; }
    return [first, attempt(make)];
  })(),
  callsNothing: (function () {
    var shape = { area() { return 7; }, make, one: 1, less: -1, list: [1, , 2], none: void 0, table: new Map(), push: Array.prototype.push, [Symbol.toStringTag]: "Shape" };
    function make() { return { __proto__: shape, side: 2 }; }
    return [attempt(make), String(make())];
  })(),
};
for (const name of Object.keys(results)) console.log(name, results[name].join(" | "));
