// A getter of a prototype literal gives an arrow, found through a literal that names its parent by __proto__.
const notes = [];
const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "object" : String(value));
const note = ask => {
  try {
    notes.push(show(ask()));
  } catch (error) {
    notes.push(error.name);
  }
};
function Base(v) {
  this.v = v;
}
Base.prototype = {
  get ask() {
    return () => this.v * 4;
  },
  set w(value) {
    this.v = value;
  },
};
function Child(v) {
  this.v = v;
}
function Second(v) {
  this.v = v;
  this.second = true;
}
Second.prototype = Object.create(Base.prototype);
try {
  (function () {
    Child.prototype = { __proto__: Base.prototype, constructor: Child };
    Child.prototype.ask = function () {
    return "child" + this.v;
  };
  })();
} catch (error) {
  notes.push(error.name);
}
const one = new Child(1);
const two = new Second(2);
const base = new Base(3);
{
  note(() => [1, 2, 3].map(v => new Child(v)).map(each => each.ask()));
}
try {
  Child.prototype = { ask: () => 77 };
} catch (error) {
  notes.push(error.name);
}
{
  note(() => [1, 2, 3].map(v => new Child(v)).map(each => each.ask()));
}
console.log(notes.join(" "));
