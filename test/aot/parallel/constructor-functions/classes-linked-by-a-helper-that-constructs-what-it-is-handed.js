// `function inherits(Below, Above) { Below.prototype = new Above(); Below.prototype.constructor = Below; }`, called for each pair of classes.
const log = [];
function inherits(Below, Above) {
  log.push("link " + Below.name + " " + Above.name);
  Below.prototype = new Above("for " + Below.name);
  Below.prototype.constructor = Below;
  return Below.prototype;
}
function Base(label) {
  log.push("Base " + label);
  this.label = label;
}
Base.prototype.who = function () {
  return "base " + this.label;
};
function Middle(label) {
  Base.call(this, label);
  this.middle = true;
}
function Leaf(label) {
  Middle.call(this, label);
  this.leaf = true;
}
function Other(label) {
  Base.call(this, label);
}
const first = inherits(Middle, Base);
Middle.prototype.who = function () {
  return "middle " + this.label;
};
const second = inherits(Leaf, Middle);
const third = inherits(Other, Base);
const leaf = new Leaf("l"), other = new Other("o"), base = new Base("b");
console.log(log.join(" . "));
console.log(first === Middle.prototype, second === Leaf.prototype, third === Other.prototype, first === third);
console.log(leaf.who(), other.who(), base.who(), Leaf.prototype.who(), Object.keys(Leaf.prototype).join(), Object.keys(Other.prototype).join());
console.log(leaf instanceof Middle, leaf instanceof Base, other instanceof Middle, leaf.constructor === Leaf, Object.getPrototypeOf(Leaf.prototype) === Middle.prototype);
