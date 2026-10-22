// Untyped sloppy CommonJS. __defineGetter__ and __defineSetter__ put accessors on the prototypes of a constructor function and of a class,
// an object literal with __proto__ replaces the link of a prototype, and `prototype.__proto__ = other` hangs another object above it.
var log = [];
function Shape(id) {
  this.id = id;
}
class Frame {
  constructor(id) {
    this.id = id;
  }
}
function areaOf(shape) {
  return shape.area;
}
function setArea(shape, value) {
  shape.area = value;
  return shape;
}
function state(shape) {
  return areaOf(shape) + " " + ("area" in shape) + " [" + Object.keys(shape) + "]";
}
var makers = [function (id) { return new Shape(id); }, function (id) { return new Frame(id); }];

var length = 0;
for (var i = 0; i < 3000; i++) {
  var shape = makers[i & 1](i);
  length += state(shape).length;
  if (i & 2) setArea(shape, 5);
  length += state(shape).length;
}
console.log("warm", length);

makers.forEach(function (make) {
  var old = make(1);
  var filled = setArea(make(2), 20);
  var holder = Object.getPrototypeOf(old);
  var name = holder.constructor.name;
  holder.__defineGetter__("area", function () { return "area of " + this.id; });
  console.log(name, "a getter:", state(old), "|", state(filled), "|", state(make(3)));
  setArea(old, 1);
  console.log(name, "a store without a setter:", state(old), holder.__lookupGetter__("area") !== undefined, old.__lookupSetter__("area"));
  holder.__defineSetter__("area", function (value) { log.push("area = " + value + " on " + this.id); });
  setArea(old, 2);
  setArea(filled, 21);
  setArea(make(4), 3);
  console.log(name, "a setter too:", state(old), "|", state(filled), "|", log.join(", "));
  log.length = 0;
  delete holder.area;
  console.log(name, "gone again:", state(old), "|", state(setArea(make(5), 6)));
  holder.__proto__ = { area: "from above", __proto__: { deeper: true } };
  console.log(name, "another object above:", state(old), "|", state(make(6)), old.deeper);
  setArea(old, 7);
  console.log(name, "stored:", state(old));
  holder.__proto__ = Object.prototype;
  console.log(name, "put back:", state(make(7)), make(8).deeper);
});
