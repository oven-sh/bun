// A class that TypeScript wrote for ES5 has its base, in an ES module, where `this` at the top is undefined: the method above is found through an heir without a look by name.
var __extends =
  (this && this.__extends) ||
  (function () {
    var extendStatics = function (d, b) {
      extendStatics =
        Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array &&
          function (d, b) {
            d.__proto__ = b;
          }) ||
        function (d, b) {
          for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p];
        };
      return extendStatics(d, b);
    };
    return function (d, b) {
      if (typeof b !== "function" && b !== null)
        throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
      extendStatics(d, b);
      function __() {
        this.constructor = d;
      }
      d.prototype = b === null ? Object.create(b) : ((__.prototype = b.prototype), new __());
    };
  })();
var Animal = /** @class */ (function () {
  function Animal(name) {
    this.name = name;
  }
  Animal.prototype.speak = function () {
    return this.name + " makes a sound";
  };
  return Animal;
})();
var Dog = /** @class */ (function (_super) {
  __extends(Dog, _super);
  function Dog(name, legs) {
    var _this = _super.call(this, name) || this;
    _this.legs = legs;
    return _this;
  }
  Dog.prototype.count = function () {
    return this.legs;
  };
  return Dog;
})(Animal);
var dog = new Dog("Rex", 4);
console.log(
  dog.speak(),
  dog.count(),
  dog instanceof Animal,
  Object.keys(Dog.prototype).join(),
  Object.getPrototypeOf(Dog) === Animal,
);
export {};
var total = 0;
for (var round = 0; round < 1000; round++) total += dog.speak().length + dog.count();
console.log(total);
