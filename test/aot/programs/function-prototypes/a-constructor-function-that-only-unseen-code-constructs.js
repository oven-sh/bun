// The neighbor: the same constructor function, and code that nobody has seen constructs it after all.
const construct = new Function("constructor", "return new constructor()");
function Base() {
  this.count = 0;
}
Base.prototype.bump = function () {
  this.count++;
  return this;
};
function Used() {
  Base.call(this);
  this.extra = 1;
}
Object.setPrototypeOf(Used.prototype, Base.prototype);
let sum = 0;
for (let round = 0; round < 500; round++) sum += new Used().bump().count;
const made = construct(Base);
console.log(sum, made.bump().count, made instanceof Base, Object.keys(made).join(), Reflect.construct(Base, []).count, Reflect.construct(Base, [], Used) instanceof Used);
