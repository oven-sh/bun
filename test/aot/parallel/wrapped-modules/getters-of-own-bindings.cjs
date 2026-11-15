// Modules wrapped by a bundler that export their own bindings by getters.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var out = [];
var show = f => { try { var v = f(); return typeof v === "function" ? "function " + v.name : String(v); } catch (e) { return e.constructor.name + ": " + e.message; } };
var require_point = __commonJS({ "src/point.js"(exports, module) {
  __export(exports, { Point: () => Point, origin: () => origin, count: () => count, make: () => make, late: () => late, never: () => never });
  out.push("point sees " + show(() => origin) + " " + show(() => make));
  class Point {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; count++; }
    add(o) { return new Point(this.x + o.x, this.y + o.y); }
    toString() { return this.x + "," + this.y; }
  }
  var count = 0, late, never;
  const origin = new Point();
  function make(x, y) { late = late === undefined ? "first" : late + "+"; return new Point(x, y); }
}});
var require_early = __commonJS({ "src/early.js"(exports, module) {
  Object.defineProperty(exports, "value", { enumerable: true, get: function () { return value; } });
  Object.defineProperty(exports, "again", { enumerable: true, get: () => again });
  var other = require_cycle();
  let value = 1;
  function again() { value++; return other.seen; }
}});
var require_cycle = __commonJS({ "src/cycle.js"(exports, module) {
  var early = require_early();
  exports.seen = show(() => early.value) + "; " + show(() => early.again);
  exports.later = () => early.value;
}});
var require_thrower = __commonJS({ "src/thrower.js"(exports, module) {
  Object.defineProperty(exports, "before", { enumerable: true, get: () => before });
  Object.defineProperty(exports, "after", { enumerable: true, get: () => after });
  const before = "set";
  if (out.length >= 0) throw new Error("thrown");
  const after = "never";
}});
var require_seen = __commonJS({ "src/seen.js"(exports, module) {
  __export(exports, { a: () => a, default: () => a });
  let a = [1, 2];
  out.push(Object.keys(exports).join() + " " + JSON.stringify(Object.getOwnPropertyDescriptor(exports, "a")));
}});
var point = require_point();
function sum(n) {
  let s = point.make(0, 0);
  for (let i = 0; i < n; i++) s = s.add(new point.Point(i, 1));
  return s;
}
out.push(String(sum(1000)), String(point.origin), String(point.count), String(point.late), show(() => point.never), show(() => point.absent));
var early = require_early();
out.push(early.again(), String(early.value), String(require_cycle().later()));
for (let i = 0; i < 2; i++) { try { require_thrower(); out.push("loaded"); } catch (e) { out.push(e.message); } }
out.push(show(() => require_thrower().before), show(() => require_thrower().after));
out.push(show(() => require_seen().a), show(() => require_seen().default === require_seen().a), show(() => { require_seen().a = 1; return require_seen().a; }));
for (const line of out) console.log(line);
