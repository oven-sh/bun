// A class as Babel 7.23 and after writes it, typeof transformed, has its members: of eight looks by name a round one is left.
"use strict";
function _typeof(o) {
  "@babel/helpers - typeof";
  return (
    (_typeof =
      "function" == typeof Symbol && "symbol" == typeof Symbol.iterator
        ? function (o) {
            return typeof o;
          }
        : function (o) {
            return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype
              ? "symbol"
              : typeof o;
          }),
    _typeof(o)
  );
}
function _defineProperties(e, r) {
  for (var t = 0; t < r.length; t++) {
    var o = r[t];
    ((o.enumerable = o.enumerable || !1),
      (o.configurable = !0),
      "value" in o && (o.writable = !0),
      Object.defineProperty(e, _toPropertyKey(o.key), o));
  }
}
function _createClass(e, r, t) {
  return (
    r && _defineProperties(e.prototype, r),
    t && _defineProperties(e, t),
    Object.defineProperty(e, "prototype", { writable: !1 }),
    e
  );
}
function _toPropertyKey(t) {
  var i = _toPrimitive(t, "string");
  return "symbol" == _typeof(i) ? i : i + "";
}
function _toPrimitive(t, r) {
  if ("object" != _typeof(t) || !t) return t;
  var e = t[Symbol.toPrimitive];
  if (void 0 !== e) {
    var i = e.call(t, r || "default");
    if ("object" != _typeof(i)) return i;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return ("string" === r ? String : Number)(t);
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
