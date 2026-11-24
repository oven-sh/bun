// Names that a program lays on Object: whoever lays, replaces or removes them, the next read finds what is there.
const seen = [];
Object.lent = function (to, given) {
  for (const name of Object.keys(given)) to[name] = given[name];
  return to;
};
function Hut() {}
Hut.prototype.roof = "straw";
function Barn(wide) {
  this.wide = wide;
}
Barn.prototype = Object.lent(new Hut(), { told: function () { return "barn" + this.wide; } });
console.log(new Barn(1).told(), new Barn(2).roof, Object.keys(Object).join());
const key = ["le", "nt"].join("");
Reflect.set(Object, key, function (to, given) {
  seen.push(to);
  to.roof = "seen";
  return to;
});
function Mill(wide) {
  this.wide = wide;
}
Mill.prototype = Object.lent(new Hut(), { told: function () { return "mill" + this.wide; } });
console.log(typeof new Mill(1).told, new Mill(2).roof, seen[0] === Mill.prototype);
Object.defineProperty(Object, "lent", { get() { return () => "got"; }, configurable: true });
console.log(Object.lent(1, 2), Object.lent.call(null));
delete Object.lent;
Function.prototype.lent = function () { return "above"; };
console.log(Object.lent(1, 2), typeof Barn.lent);
delete Function.prototype.lent;
console.log(typeof Object.lent);
try {
  Object.lent(new Hut(), {});
} catch (error) {
  console.log(error.constructor.name);
}
(0, eval)("Object.lent = function (to) { to.told = function () { return 'evaluated'; }; return to; }");
function Shed(wide) {
  this.wide = wide;
}
Shed.prototype = Object.lent(new Hut(), { told: function () { return "shed" + this.wide; } });
console.log(new Shed(3).told());
class Sub extends Object {
  static reach() {
    return typeof super.lent;
  }
}
console.log(Sub.reach(), typeof Sub.lent, typeof Object.create(Object).lent);
