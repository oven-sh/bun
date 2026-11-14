// new NS.Base() is a prototype that the build follows, although Base only passes its arguments on to a method that ignores its object.
// STATISTIC: OperationsSwept <= 2000
var Class = {
  create: function () {
    return function () {
      this.initialize.apply(this, arguments);
    };
  },
};
var NS = {};
NS.Base = Class.create();
NS.Base.prototype = {
  gloss: 2,
  initialize: function () {},
  name: function () {
    return "base";
  },
  twice: function () {
    return this.size * 2 + this.gloss;
  },
};
NS.Box = Class.create();
NS.Box.prototype = new NS.Base();
NS.Box.prototype.initialize = function (size) {
  this.size = size;
};
NS.Ball = Class.create();
NS.Ball.prototype = new NS.Base();
NS.Ball.prototype.initialize = function (size, color) {
  this.size = size;
  this.color = color;
};
NS.Ball.prototype.name = function () {
  return "ball" + this.color;
};
function run(count) {
  let total = 0;
  for (let index = 0; index < count; index++) total += new NS.Box(index).twice() + new NS.Ball(index, 1).twice();
  return total;
}
console.log(run(20), new NS.Box(1).name(), new NS.Ball(1, 2).name());
