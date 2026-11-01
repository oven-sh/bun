// The constructor stores under a name that the prototype object above has a setter for: the setter is called, with the new object.
const taken = [];
function Base(size) {
  this.size = size;
  this.plain = size + 1;
}
Object.defineProperty(Base.prototype, "size", {
  set(value) {
    taken.push([this, value]);
  },
  get() {
    return "from the getter";
  },
});
function Derived(size) {
  Base.call(this, size);
}
Derived.prototype = new Base(3);
const made = new Derived(4);
console.log(taken.length, taken[0][0] === Derived.prototype, taken[0][1], taken[1][0] === made, taken[1][1]);
console.log(Object.keys(Derived.prototype).join(), Object.keys(made).join(), made.size, Derived.prototype.size, made.plain);
