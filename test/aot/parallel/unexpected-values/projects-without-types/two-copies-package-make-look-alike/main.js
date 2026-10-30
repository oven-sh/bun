var left = require("left");
var right = require("right");
var attempt = require("./show").attempt;

console.log("this file is strict:", (function () {
  return this === undefined;
})());

var sum = 0;
for (var i = 0; i < 2000; i++) sum += left.measure(left.add(left.make(i, 1), left.make(1, 1)));
console.log("sum", sum);
attempt("versions", function () { return [left.Vector.version, right.Vector.version, left.Vector === right.Vector]; });
var sides = { left: left, right: right };
Object.keys(sides).forEach(function (maker) {
  Object.keys(sides).forEach(function (user) {
    attempt(user + ".measure(" + maker + ".make)", function () { return sides[user].measure(sides[maker].make(1, 2)); });
    attempt(user + ".add(" + user + ".make, " + maker + ".make)", function () { return sides[user].add(sides[user].make(1, 2), sides[maker].make(3, 4)); });
    attempt(maker + ".make instanceof " + user + ".Vector", function () { return sides[maker].make(1, 2) instanceof sides[user].Vector; });
    attempt(user + "'s method on " + maker + "'s object", function () { return sides[user].Vector.prototype.length2.call(sides[maker].make(1, 2)); });
  });
});
