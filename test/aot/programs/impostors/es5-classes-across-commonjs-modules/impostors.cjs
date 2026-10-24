var Shape = require("./shape.cjs");

exports.log = [];

exports.list = [
  ["a literal with the same names", function () { return { name: "literal", sides: 4, edge: 2, describe: function () { return "a literal"; }, perimeter: function () { return "its own perimeter"; }, area: function () { return "its own area"; } }; }],
  ["a literal under Shape.prototype", function () { return { __proto__: Shape.prototype, edge: 2, sides: 5, name: "pentagon" }; }],
  ["an object made from Shape.prototype alone", function () { return Object.create(Shape.prototype); }],
  ["a shape with getters", function () { var shape = new Shape("getter", 0); Object.defineProperty(shape, "sides", { get: function () { exports.log.push("get sides"); return 6; } }); shape.edge = 2; return shape; }],
  ["a shape with strings", function () { var shape = new Shape(7, "4"); shape.edge = "2"; return shape; }],
  ["another Shape of the same text", function () { function Shape(name, sides) { this.sides = sides; this.name = name; } Shape.prototype.describe = function () { return "the other Shape " + this.name; }; return new Shape("other", 4); }],
  ["a frozen shape", function () { return Object.freeze(new Shape("frozen", 4)); }],
  ["a string", function () { return "shape"; }],
  ["null", function () { return null; }],
];

exports.patch = function () {
  Shape.prototype.describe = function () {
    return "patched from another module: " + this.name;
  };
};
