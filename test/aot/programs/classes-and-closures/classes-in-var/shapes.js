// As a bundler writes class declarations.
var Point = class {
  constructor(x, y) { this.x = x; this.y = y; }
  sum() { return this.x + this.y; }
  static origin() { return new Point(0, 0); }
};
var Point3 = class extends Point {
  constructor(x, y, z) { super(x, y); this.z = z; }
  sum() { return super.sum() + this.z; }
};
var Bare = class {};
var Named = class Inner { who() { return Inner.name + " " + (this instanceof Inner); } };
let Swapped = class { kind() { return "first"; } };
function swap() { Swapped = class { kind() { return "second"; } }; }
var Early = (() => { try { return new Late(); } catch (error) { return error.constructor.name; } })();
var earlyType = typeof Late;
var Late = class { kind() { return "late"; } };
var Twice = class { kind() { return "one"; } };
var Twice = class { kind() { return "two"; } };
var makeLocal = (n) => { var Local = class { n() { return n; } }; return new Local(); };
export { Point, Point3, Bare, Named, Swapped, swap, Early, earlyType, Late, Twice, makeLocal };
