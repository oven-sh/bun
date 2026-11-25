// RUN: link
// `_this = _possibleConstructorReturn(this, P.call(this))`: what is stored into `_this` is a field, and what is defined on `_assertThisInitialized(_this)`. The answer of a function that answers something else is none.
// CHECK: layout {{*}}name="Dog" {{*}}key="years" declared={type=anything} flags=[IsRequired]}
// CHECK: layout {{*}}name="Cat" {{*}}key="lives" declared={type=anything} flags=[IsRequired]}, {key="owner" declared={type=anything} flags=[IsRequired]}

// RUN(NONE): link
// NONE-NOT: layout {{*}}name="Other" {{*}}key="years"

"use strict";
function _possibleConstructorReturn(self, call) {
  if (!self) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }
  return call && (typeof call === "object" || typeof call === "function") ? call : self;
}
function _assertThisInitialized(self) {
  if (self === void 0) {
    throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
  }
  return self;
}
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = value;
  }
  return obj;
}
function made(self, call) {
  return { self, call };
}
export function Animal(name) {
  this.name = name;
}
Animal.prototype.weigh = function () { return this.name; };
export function Dog(name) {
  var _this = _possibleConstructorReturn(this, Animal.call(this, name));
  _this.years = 3;
  return _this;
}
Dog.prototype = Object.create(Animal.prototype, { constructor: { value: Dog, writable: true, configurable: true } });
export function Cat(name) {
  var _this;
  _this = _possibleConstructorReturn(this, Animal.call(this, name));
  _defineProperty(_assertThisInitialized(_this), "lives", 9);
  _defineProperty(_this, "owner", null);
  return _this;
}
Cat.prototype = Object.create(Animal.prototype, { constructor: { value: Cat, writable: true, configurable: true } });
export function Other(name) {
  var _this = made(this, Animal.call(this, name));
  _this.years = 3;
}
Other.prototype.weigh = function () { return 1; };
export const animals = [new Dog("a"), new Cat("b"), new Other("c")];
