// F.prototype = Object.extend(new Base(), { .. }): the build follows the function laid on Object, and the names that the call copies.
// STATISTIC: OperationsSwept <= 2000
Object.extend = function (destination, source) {
  for (var property in source) {
    destination[property] = source[property];
  }
  return destination;
};
function Base() {}
Base.prototype = {
  gloss: 2,
  name: function () {
    return "base";
  },
  twice: function () {
    return this.size * 2 + this.gloss;
  },
};
function Box(size) {
  this.size = size;
}
Box.prototype = Object.extend(new Base(), {
  depth: 3,
  name: function () {
    return "box" + this.depth;
  },
});
function Ball(size, color) {
  this.size = size;
  this.color = color;
}
Ball.prototype = Object.extend(new Base(), {
  paint: null,
  name: function () {
    return "ball" + this.color + this.paint;
  },
});
function run(count) {
  let total = 0;
  for (let index = 0; index < count; index++) total += new Box(index).twice() + new Ball(index, 1).twice();
  return total;
}
console.log(run(20), new Box(1).name(), new Ball(1, 2).name());
