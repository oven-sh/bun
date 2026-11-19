// new Base() may be an object that somebody else has: then two constructors share their prototype.
let cache = null;
function Base() {
  if (cache) return cache;
}
Base.prototype.kind = "base";
cache = new Base();
function First(x) {
  this.x = x;
}
First.prototype = new Base();
First.prototype.name = function () {
  return "first" + this.x;
};
function Second(x) {
  this.x = x;
}
Second.prototype = new Base();
Second.prototype.name = function () {
  return "second" + this.x;
};
console.log(new First(1).name(), new Second(2).name(), First.prototype === Second.prototype);
let kept;
function Keeper() {
  kept = () => this;
}
function Third(x) {
  this.x = x;
}
Third.prototype = new Keeper();
Third.prototype.name = function () {
  return "third" + this.x;
};
kept().name = function () {
  return "kept" + this.x;
};
console.log(new Third(3).name(), kept() === Third.prototype);
let filled = null;
function Filler() {
  if (filled) return filled;
  this.size = 1;
}
filled = new Filler();
function Fourth(x) {
  this.x = x;
}
Fourth.prototype = new Filler();
Fourth.prototype.name = function () {
  return "fourth" + this.x;
};
function Fifth(x) {
  this.x = x;
}
Fifth.prototype = new Filler();
Fifth.prototype.name = function () {
  return "fifth" + this.x + this.size;
};
console.log(new Fourth(4).name(), new Fifth(5).name());
function Empty() {}
function Sixth(x) {
  this.x = x;
}
Sixth.prototype = new Empty();
Sixth.prototype.name = function () {
  return "sixth" + this.x;
};
Empty.prototype.name = function () {
  return "empty";
};
Empty.prototype.far = function () {
  return "far" + this.x;
};
const six = new Sixth(6);
console.log(six.name(), six.far(), six instanceof Empty, Object.getPrototypeOf(Sixth.prototype) === Empty.prototype);
Object.setPrototypeOf(Sixth.prototype, { far() { return "farther"; } });
console.log(six.far(), six instanceof Empty);
Sixth.prototype[["na", "me"].join("")] = () => "changed";
console.log(six.name());
