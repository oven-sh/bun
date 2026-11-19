// Flags: --aot-harden=proof-checks
// Nobody makes an object that these loops step to. The step is a name from before the loop, which holds null alone.
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
function replaced(x, other, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (x) {
      sum += x.mark();
      x = other;
    }
  }
  return sum;
}
function read(x, other) {
  let sum = 0;
  while (x) {
    sum += x.mark();
    x = other.next;
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
  say(() => replaced(none, none, k));
  say(() => read(none, none));
}
