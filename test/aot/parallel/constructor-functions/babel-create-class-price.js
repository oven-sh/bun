// A class as Babel 7.20 to 7.22 writes it has its members: of eight looks by name a round one is left.
"use strict";
function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
  }
}
function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  Object.defineProperty(Constructor, "prototype", { writable: false });
  return Constructor;
}
function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, "string");
  return typeof key === "symbol" ? key : String(key);
}
function _toPrimitive(input, hint) {
  if (typeof input !== "object" || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || "default");
    if (typeof res !== "object") return res;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (hint === "string" ? String : Number)(input);
}
var Animal = /*#__PURE__*/ (function () {
  function Animal(name) {
    this._name = name;
  }
  return _createClass(
    Animal,
    [
      {
        key: "speak",
        value: function speak() {
          return this.name + " makes a sound";
        },
      },
      {
        key: "name",
        get: function get() {
          return this._name;
        },
        set: function set(name) {
          this._name = name;
        },
      },
    ],
    [
      {
        key: "of",
        value: function of(name) {
          return new Animal(name);
        },
      },
    ],
  );
})();
function turn(name) {
  var animal = Animal.of(name);
  animal.name = animal.name + "!";
  return animal.speak();
}
console.log(
  turn("Rex"),
  Object.getOwnPropertyNames(Animal.prototype).join(),
  Object.keys(Animal.prototype).length,
  Object.getOwnPropertyDescriptor(Animal, "prototype").writable,
);
var total = 0;
for (var round = 0; round < 1000; round++) total += turn("Rex").length;
console.log(total);
