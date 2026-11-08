var __extends = function (d, b) { function __() { this.constructor = d; } __.prototype = b.prototype; d.prototype = new __(); };
var Animal = (function () { function Animal(name) { this.name = name; } Animal.prototype.speak = function () { return this.name + " makes a sound"; }; return Animal; }());
var Dog = (function (_super) {
  __extends(Dog, _super);
  function Dog(name) { var _this = _super.call(this, name) || this; _this.tricks = 0; return _this; }
  Dog.prototype.speak = function () { this.tricks++; return _super.prototype.speak.call(this) + " and barks"; };
  return Dog;
}(Animal));
var rex = new Dog("Rex");
console.log(rex.speak(), rex.tricks, rex instanceof Dog, rex instanceof Animal, new Dog("Ada").speak(), rex.constructor === Dog, Object.getPrototypeOf(Dog.prototype) === Animal.prototype);
Animal = function () { this.name = "nobody"; };
console.log(new Dog("Bo").speak());
