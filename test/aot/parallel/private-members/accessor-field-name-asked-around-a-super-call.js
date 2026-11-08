// `#name in this` for an `accessor` field of a derived class: the constructor of the base class asks before `super()` returns, a field of the derived class and its constructor ask after
const lines = [];
class Base {
  constructor() {
    lines.push("in the base constructor: " + Derived.has(this));
  }
}
class Derived extends Base {
  before = #level in this;
  accessor #level = 5;
  constructor() {
    super();
    lines.push("after super(): " + (#level in this) + " " + this.before + " " + this.#level);
  }
  static has(value) {
    return #level in value;
  }
}
new Derived();
lines.push("an instance of the base class: " + Derived.has(new Base()));
console.log(lines.join("\n"));
