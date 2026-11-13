// Flags: --aot-harden=proof-checks
// Nobody makes an object that these loops step through. A step that is read off the loop's own name throws while the name is null, so the loop holds no other value.
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
function passed(first) {
  let sum = 0;
  for (let x = first; x; x = x.next) sum += x.mark();
  return sum;
}
function absent() {
  let sum = 0;
  for (let x = null; x; x = x.next) sum += x.mark();
  return sum;
}
function stepped(x) {
  let sum = 0;
  while (x) {
    sum += x.mark();
    x = x.step();
  }
  return sum;
}
function joined(x, isFar) {
  let sum = 0;
  while (x) {
    sum += x.mark();
    x = isFar ? x.next.next : x.next?.next;
  }
  return sum;
}
function followed(x) {
  let sum = 0;
  for (let before = null; x; x = x.next) {
    if (before) sum += before.mark();
    sum += x.mark();
    before = x;
  }
  return sum;
}
function asked(x, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (!x) continue;
    sum += x.mark();
    x = x.next;
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
  say(() => passed(none));
  say(() => absent());
  say(() => stepped(none));
  say(() => joined(none, k > 1));
  say(() => followed(none));
  say(() => asked(none, k));
}
