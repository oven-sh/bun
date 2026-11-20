// What tsc writes for three classes at target ES5. In turn five unseen text lays a `call` of its own on Animal that returns another object: from there on that object stands for `this` in Dog and in Puppy, and each construction gives it.
var __extends = (this && this.__extends) || (function () {
  var extendStatics = function (d, b) { extendStatics = Object.setPrototypeOf || ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) || function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; }; return extendStatics(d, b); };
  return function (d, b) { if (typeof b !== "function" && b !== null) throw new TypeError("Class extends value " + String(b) + " is not a constructor or null"); extendStatics(d, b); function __() { this.constructor = d; } d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __()); };
})();
var Animal = /** @class */ (function () { function Animal(name) { this.name = name; this.legs = 4; } Animal.prototype.score = function () { return this.name.length + this.legs; }; return Animal; }());
var Dog = /** @class */ (function (_super) { __extends(Dog, _super); function Dog(name, age) { var _this = _super.call(this, name) || this; _this.age = age; return _this; } Dog.prototype.total = function () { return this.score() + this.age; }; return Dog; }(Animal));
var Puppy = /** @class */ (function (_super) { __extends(Puppy, _super); function Puppy(name) { var _this = _super.call(this, name, 1) || this; _this.toy = "ball"; return _this; } Puppy.prototype.all = function () { return this.total() + this.toy.length; }; return Puppy; }(Dog));
globalThis.classes = { Animal: Animal, Dog: Dog, Puppy: Puppy };
globalThis.arrived = "";
var change = function (text) { return (0, eval)(text); };
function run(count) {
  var text = "";
  for (var i = 0; i < count; i++) {
    if (i === 5) change("classes.Animal.call = function (self, name) { arrived += Object.keys(self).length; return { legs: 2, name: name + name, total: classes.Dog.prototype.total, score: classes.Animal.prototype.score, all: classes.Puppy.prototype.all }; };");
    var dog = new Dog("rex", i);
    var puppy = new Puppy("bo");
    text += dog.total() + ":" + puppy.all() + ":" + Object.keys(dog).length + Object.keys(puppy).length + (dog instanceof Dog ? "d" : "-") + (puppy instanceof Puppy ? "p" : "-") + " ";
  }
  return text;
}
console.log(run(10), globalThis.arrived);
