// Four constructor functions above one another by their prototypes. Only one step up is followed, so the chain is not seen to end.
// Flags: --aot-limit=MaxConstructorParentsFollowed:1
// STATISTIC: MaxConstructorParentsFollowedHits >= 1
function First() {
  this.a = 1;
}
First.prototype.first = function () {
  return this.a + 10;
};
First.prototype.shared = function () {
  return "of First";
};
First.prototype.plain = "on First";
function Second() {
  First.call(this);
  this.b = 2;
}
Second.prototype = Object.create(First.prototype);
Second.prototype.constructor = Second;
Second.prototype.shared = function () {
  return "of Second";
};
function Third() {
  Second.call(this);
  this.c = 3;
}
Third.prototype = Object.create(Second.prototype);
Third.prototype.constructor = Third;
function Fourth() {
  Third.call(this);
  this.d = 4;
}
Fourth.prototype = Object.create(Third.prototype);
Fourth.prototype.constructor = Fourth;
Fourth.prototype.fourth = function () {
  return this.first() + this.d;
};
function look(o) {
  return [o.first(), o.fourth(), o.a, o.d, o.plain, o.shared(), "first" in o, "none" in o, String(o.none), o instanceof First, Object.keys(o).join()].join(" "); // prettier-ignore
}
let last = "";
for (let i = 0; i < 300; i++) last = look(new Fourth());
console.log(last);
First.prototype.late = function () {
  return "late";
};
console.log(new Fourth().late());
delete First.prototype.plain;
console.log(String(new Fourth().plain));
