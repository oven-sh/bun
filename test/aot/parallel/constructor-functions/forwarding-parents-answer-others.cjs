// The method that a constructor passes its arguments on to answers, keeps or fills the object: then the prototypes are not the program's alone.
const Class = {
  create: function () {
    return function () {
      return this.initialize.apply(this, arguments);
    };
  },
};
let cache = null;
const Base = Class.create();
Base.prototype = {
  initialize: function () {
    return cache;
  },
  kind: "base",
};
cache = new Base();
function First(x) {
  this.x = x;
}
First.prototype = new Base();
First.prototype.name = function () {
  return "first" + this.x;
};
function Second(x) {
  this.x = x;
}
Second.prototype = new Base();
Second.prototype.name = function () {
  return "second" + this.x;
};
console.log(new First(1).name(), new Second(2).name(), First.prototype === Second.prototype);
let kept = null;
function Keeper() {
  this.initialize.apply(this, arguments);
}
Keeper.prototype.initialize = function () {
  kept = this;
};
function Third(x) {
  this.x = x;
}
Third.prototype = new Keeper();
Third.prototype.name = function () {
  return "third" + this.x;
};
kept.name = function () {
  return "kept" + this.x;
};
console.log(new Third(3).name(), kept === Third.prototype);
function Late() {
  this.initialize.apply(this, arguments);
}
Late.prototype.initialize = function () {};
function Fourth(x) {
  this.x = x;
}
Late.prototype[["initial", "ize"].join("")] = function () {
  kept = this;
};
Fourth.prototype = new Late();
Fourth.prototype.name = function () {
  return "fourth" + this.x;
};
kept.name = function () {
  return "late" + this.x;
};
console.log(new Fourth(4).name(), kept === Fourth.prototype);
