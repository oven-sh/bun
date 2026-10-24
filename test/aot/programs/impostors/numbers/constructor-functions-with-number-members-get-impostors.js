function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

var inherits = require("util").inherits;

function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype.plus = function (other) {
  return new Vector(this.x + other.x, this.y + other.y);
};
Vector.prototype.times = function (factor) {
  return new Vector(this.x * factor, this.y * factor);
};
Vector.prototype.dot = function (other) {
  return this.x * other.x + this.y * other.y;
};
Vector.prototype.cell = function () {
  return [this.x | 0, this.y >> 1];
};
Vector.prototype.step = function () {
  this.x++;
  this.y -= 1;
  return this;
};
Vector.prototype.list = function () {
  return [this.x, this.y];
};

function Vector3(x, y, z) {
  Vector.call(this, x, y);
  this.z = z;
}
Vector3.prototype = Object.create(Vector.prototype);
Vector3.prototype.constructor = Vector3;
Vector3.prototype.list = function () {
  return Vector.prototype.list.call(this).concat([this.z]);
};

function Weighted(x, y, weight) {
  Vector.call(this, x, y);
  this.weight = weight;
}
inherits(Weighted, Vector);
Weighted.prototype.dot = function (other) {
  return Vector.prototype.dot.call(this, other) * this.weight;
};

var total = 0;
for (var i = 0; i < 2000; i++) {
  var a = new Vector(i, 1);
  var b = new Vector3(1, i, 2);
  var c = new Weighted(i, i, 2);
  total += a.plus(b).dot(c) + a.times(2).x + a.cell()[0] + b.step().y + c.dot(a);
}
console.log("the honest total", total);

var impostors = ["3", "", 0.5, -0, null, undefined, true, 3n, NaN, 2147483647, [3], { valueOf: function () { return 3; } }, Symbol("s")];
impostors.forEach(function (value) {
  var label = show(value);
  attempt("new Vector(" + label + ", 1).plus", function () { return new Vector(value, 1).plus(new Vector(1, 1)).list(); });
  attempt("plus(new Vector(" + label + ", 1))", function () { return new Vector(1, 1).plus(new Vector(value, 1)).list(); });
  attempt("new Vector(" + label + ", 1).times(2)", function () { return new Vector(value, 1).times(2).list(); });
  attempt("new Vector(1, 1).times(" + label + ")", function () { return new Vector(1, 1).times(value).list(); });
  attempt("new Vector(" + label + ", 1).dot", function () { return new Vector(value, 1).dot(new Vector(2, 2)); });
  attempt("new Vector(" + label + ", " + label + ").cell", function () { return new Vector(value, value).cell(); });
  attempt("new Vector(" + label + ", " + label + ").step", function () { return new Vector(value, value).step().list(); });
  attempt("new Vector3(1, 1, " + label + ").list", function () { return new Vector3(1, 1, value).list(); });
  attempt("new Weighted(1, 1, " + label + ").dot", function () { return new Weighted(1, 1, value).dot(new Vector(2, 2)); });
});

attempt("plus of a plain object", function () { return new Vector(1, 1).plus({ x: "1", y: 1 }).list(); });
attempt("plus of an object without y", function () { return new Vector(1, 1).plus({ x: 1 }).list(); });
attempt("plus of a number", function () { return new Vector(1, 1).plus(5).list(); });
attempt("plus of null", function () { return new Vector(1, 1).plus(null).list(); });
attempt("a method borrowed by a plain object", function () { return Vector.prototype.dot.call({ x: "2", y: "3" }, { x: 2, y: 3 }); });
attempt("a method borrowed by an array", function () { return Vector.prototype.cell.call(Object.assign([], { x: 1.9, y: 5 })); });
attempt("called without new in sloppy code", function () {
  var before = typeof globalThis.x;
  var result = Vector("leaked", 1);
  var seen = [before, result, globalThis.x, globalThis.y];
  delete globalThis.x;
  delete globalThis.y;
  return seen;
});
attempt("too few arguments", function () { return new Vector(1).plus(new Vector(1, 1)).list(); });
attempt("a member on the prototype", function () {
  Vector.prototype.z = "inherited";
  var seen = [new Vector(1, 1).z, new Vector3(1, 1, 5).z];
  delete Vector.prototype.z;
  return seen;
});
attempt("honest vectors afterwards", function () { return [new Vector(1, 2).plus(new Vector(3, 4)).list(), new Vector(1, 2).dot(new Vector(3, 4)), new Weighted(1, 2, 3).dot(new Vector(3, 4))]; });
