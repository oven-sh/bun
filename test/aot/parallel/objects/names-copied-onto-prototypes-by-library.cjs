var quiet = Object.assign({}, console, { log: function () {} });
var util = require("node:util");
var lines = [];
function Point(x) {
  this.x = x;
}
function Box() {
  this.list = new Array(1, 2);
}
Box.prototype.fill = function () {
  this.list[0] = new Point(0.5);
  return this;
};
Box.prototype.kind = function (i) {
  var x = this.list[i].x;
  return x === undefined ? "none" : typeof x;
};
Box.prototype.sum = function () {
  for (var i = 0, sum = 0; i < 2; i++) {
    var x = this.list[i].x;
    if (x !== undefined) sum += x;
  }
  return sum;
};
function run(count) {
  var box = new Box().fill(),
    text = "";
  for (var i = 0; i < count; i++) text += box.kind(i & 1) + box.sum() + " ";
  return text;
}
function twice(box) {
  for (var i = 0, t = 0; i < 3; i++) t = box.sum() + t;
  return t * 2 + box.sum();
}
lines.push(run(4), twice(new Box()));

var unknown = JSON.parse('[5, {"x": 1}]');
util._extend(Object.getPrototypeOf(unknown[0]), { x: "text" });
lines.push(run(4), twice(new Box()), (5).x, typeof quiet.warn);
util._extend(Object.getPrototypeOf(unknown[0]), { x: undefined });
lines.push(run(2), new Box().sum());
console.log(lines.join("\n"));
