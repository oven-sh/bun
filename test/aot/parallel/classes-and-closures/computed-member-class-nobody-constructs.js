// Computed member of a class nobody constructs.
const unseen = new Function("x", "return x");
function Base() {
  this.count = 0;
}
Base.prototype.bump = function () {
  this.count++;
  return this;
};
const key = Symbol("key");
class Unused extends Base {
  [key]() {}
  bump() {
    return "unused";
  }
}
function Used() {
  Base.call(this);
  this.extra = 1;
}
Object.setPrototypeOf(Used.prototype, Base.prototype);
unseen(Unused);
unseen(Used);
function work(object) {
  return object.bump().count + object.extra;
}
let sum = 0;
for (let round = 0; round < 500; round++) sum += work(new Used());
console.log(sum, new Unused().bump(), typeof Unused.prototype[key]);
