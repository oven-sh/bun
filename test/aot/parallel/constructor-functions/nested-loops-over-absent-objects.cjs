// Flags: --aot-harden=proof-checks
// Nobody makes an object that the inner loop steps through. The outer loop carries its name.
function Base(next) {
  this.next = next;
  this.flags = 0;
}
function Heir(next) {}
function inherit(heir, base) {
  function Link() {}
  Link.prototype = base.prototype;
  heir.prototype = new Link();
}
(function () {
  var Local = Base;
  Local.prototype.first = function () {};
  Local.prototype.mark = function () {
    this.flags = (this.flags + 1) & 7;
    return this.flags;
  };
  Local.prototype.step = function () {
    this.flags = (this.flags + 1) & 7;
    return this.next;
  };
  Local.prototype.last = function () {};
})();
inherit(Heir, Base);
function nested(x, count) {
  let sum = 0;
  let turns = 0;
  for (let i = 0; i < count; i++) {
    for (; x; ) {
      sum += x.mark();
      x = i > 1 ? x.next.next : x.step();
      if (++turns > 9) break;
    }
  }
  return sum;
}
let none = null;
const say = run => {
  try {
    console.log(run());
  } catch (error) {
    console.log(error.name);
  }
};
say(() => delete Heir.prototype.first);
for (let k = 0; k < 3; k++) {
  say(() => nested(none, k));
}
