// Prototypes hold default values under the names of fields that an initializer or only some constructions store.
function attempt(f) { try { return String(f()); } catch (e) { return e.name; } }
var Class = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
var ns = {};
ns.Vector = Class.create();
ns.Vector.prototype = {
  x: 0.0, y: 0.0, z: 0.0,
  initialize: function (x, y, z) { this.x = x ? x : 0; this.y = y ? y : 0; if (z) this.z = z; },
  dot: function (w) { return this.x * w.x + this.y * w.y + this.z * w.z; },
  add: function (v) { return new ns.Vector(this.x + v.x, this.y + v.y, this.z + v.z); },
};
function Part(x, y) { if (x) this.x = x; this.y = y; }
Part.prototype = { x: 7, y: null, label: "none", flag: false, sum: function () { return this.x + this.y; }, show: function () { return this.label + this.flag + this.x; } };
function run(n) {
  let s = 0;
  let v = new ns.Vector(1, 2, 0);
  for (let i = 0; i < n; i++) { v = v.add(new ns.Vector(i, 0.5, i & 1)); s += v.dot(v) + new Part(i & 3, i).sum(); }
  return s;
}
const bare = new Part(0, 1), late = new Part(2, 3);
late.label = "late";
console.log(run(10), run(40), bare.show(), late.show(), Object.keys(new ns.Vector(1, 2)).join(), new ns.Vector(1, 2).z);
ns.Vector.prototype.z = 5;
Part.prototype.x = "text";
console.log(run(4), bare.show(), attempt(() => bare.sum()));
delete ns.Vector.prototype.z;
console.log(run(4), new ns.Vector(1, 2).z, attempt(() => new ns.Vector(1, 2).dot(new ns.Vector(1, 2, 3))));
let set = 0;
Object.defineProperty(ns.Vector.prototype, "z", { get() { return 100; }, set(v) { set += v; }, configurable: true });
console.log(run(4), set, new ns.Vector(1, 2, 3).z, Object.keys(new ns.Vector(1, 2, 3)).join());
Object.defineProperty(Part.prototype, "y", { value: 1, writable: false, configurable: true });
console.log(attempt(() => new Part(1, 2).sum()), attempt(() => late.sum()));
delete late.x;
Part.prototype.x = { valueOf() { set++; return 3; } };
console.log(late.show().length, attempt(() => late.x + 1), set);
