// Names that a program lays on Object: whoever lays, replaces or removes them, the next read finds what is there.
const seen = [];
Object.extend = function (to, from) {
  for (var name in from) to[name] = from[name];
  return to;
};
function Base() {}
Base.prototype.kind = "base";
function Box(size) {
  this.size = size;
}
Box.prototype = Object.extend(new Base(), { name: function () { return "box" + this.size; } });
console.log(new Box(1).name(), new Box(2).kind, Object.keys(Object).join());
const key = ["ext", "end"].join("");
Reflect.set(Object, key, function (to, from) {
  seen.push(to);
  to.kind = "seen";
  return to;
});
function Ball(size) {
  this.size = size;
}
Ball.prototype = Object.extend(new Base(), { name: function () { return "ball" + this.size; } });
console.log(typeof new Ball(1).name, new Ball(2).kind, seen[0] === Ball.prototype);
Object.defineProperty(Object, "extend", { get() { return () => "got"; }, configurable: true });
console.log(Object.extend(1, 2), Object.extend.call(null));
delete Object.extend;
Function.prototype.extend = function () { return "above"; };
console.log(Object.extend(1, 2), typeof Box.extend);
delete Function.prototype.extend;
console.log(typeof Object.extend);
try {
  Object.extend(new Base(), {});
} catch (error) {
  console.log(error.constructor.name);
}
(0, eval)("Object.extend = function (to) { to.name = function () { return 'evaluated'; }; return to; }");
function Cone(size) {
  this.size = size;
}
Cone.prototype = Object.extend(new Base(), { name: function () { return "cone" + this.size; } });
console.log(new Cone(3).name());
class Sub extends Object {
  static reach() {
    return typeof super.extend;
  }
}
console.log(Sub.reach(), typeof Sub.extend, typeof Object.create(Object).extend);
