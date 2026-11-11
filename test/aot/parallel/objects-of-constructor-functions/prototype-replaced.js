var __extends = (this && this.__extends) || (function () {
  var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; }; return extendStatics(d, b); };
  return function (d, b) { if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null"); extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); };
})();
var Animal = /** @class */ (function () { function Animal(name) { this.name = name; this.legs = 4; } Animal.prototype.score = function () { return this.name.length + this.legs; }; return Animal; }());
var Dog = /** @class */ (function (_super) { __extends(Dog, _super); function Dog(name, age) { var _this = _super.call(this, name) || this; _this.age = age; return _this; } Dog.prototype.total = function () { return this.score() + this.age; }; return Dog; }(Animal));
globalThis.Dog = Dog;
function inner(count) { var total = 0; for (var i = 0; i < count; i++) { var d = new Dog("rex", i); total += d.total() + (d instanceof Dog ? 10 : 0) + (Object.getPrototypeOf(d) === Dog.prototype ? 1000 : 0); } return total; }
var sum = 0;
for (var turn = 0; turn < 10; turn++) {
  if (turn === 5) (0, eval)("Dog.prototype = { total() { return 1; } }");
  sum += inner(2);
}
console.log(sum);
