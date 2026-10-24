var Shape = require("./shape.cjs");
var squares = require("./square.cjs");
var Triangle = require("./triangle.cjs");
var measure = require("./measure.cjs");

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  return String(value);
}

function attempt(label, run, log) {
  var line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log && log.length ? " | log " + log.splice(0).join(", ") : ""));
}

console.log("strict code:", (function () { return this === undefined; })());

var total = 0;
for (var i = 0; i < 2000; i++) {
  var shape = i % 2 ? squares.make(i % 5) : Triangle(i % 5);
  total += measure.describe(shape).length + measure.perimeter(shape) + measure.area(shape) + measure.sides(shape);
}
console.log("2000 honest shapes", total);

attempt("a square", function () { return [measure.describe(squares.make(2)), measure.perimeter(squares.make(2)), measure.area(squares.make(2))]; });
attempt("a triangle without new", function () { return [measure.describe(Triangle(2)), measure.perimeter(Triangle(2)), measure.area(Triangle(2))]; });
attempt("instanceof across modules", function () { return [squares.make(1) instanceof Shape, Triangle(1) instanceof Shape, squares.make(1) instanceof Triangle]; });
attempt("super_", function () { return squares.Square.super_ === Shape; });

var Circle = require("./circle.cjs");
var link = require("./link.cjs");
var unlinked = new Circle(2);
attempt("a circle before another module links it", function () { return [measure.area(unlinked), unlinked instanceof Shape]; });
attempt("describe() before the link", function () { return measure.describe(unlinked); });
link.relink(Circle, Shape);
attempt("after another module relinked its prototype, the old circle", function () { return [measure.describe(unlinked), measure.perimeter(unlinked), unlinked instanceof Shape]; });
attempt("after another module relinked its prototype, a new circle", function () { return [measure.describe(new Circle(3)), measure.area(new Circle(3))]; });
link.replace(Circle, squares.Square);
attempt("after another module replaced its prototype, the old circle", function () { return [measure.describe(unlinked), unlinked instanceof Circle, unlinked instanceof squares.Square]; });
attempt("after another module replaced its prototype, a new circle", function () { return [measure.describe(new Circle(3)), measure.area(new Circle(3)), new Circle(3) instanceof squares.Square]; });

var impostors = require("./" + ["impo", "stors"].join("") + ".cjs");
impostors.list.forEach(function (pair) {
  Object.keys(measure).forEach(function (name) {
    attempt(pair[0] + ": " + name, function () { return measure[name](pair[1]()); }, impostors.log);
  });
  attempt("honest again", function () { return [measure.describe(squares.make(2)), measure.area(Triangle(2))]; });
});

impostors.patch();
attempt("after another module patched Shape.prototype, a square", function () { return measure.describe(squares.make(2)); });
attempt("after another module patched Shape.prototype, a triangle", function () { return measure.describe(new Triangle(2)); });

attempt("the module loaded by a computed name is the one with the plain name", function () { return require("./impostors.cjs") === impostors; });
