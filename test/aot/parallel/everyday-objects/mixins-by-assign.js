// Methods copied onto prototypes by Object.assign and by descriptors
const Walk = { walk(n) { return this.name + " walks " + n; } };
const Swim = {
  get wet() {
    return this.depth > 0;
  },
  swim(n) {
    this.depth = n;
    return this;
  },
};
function Creature(name) {
  this.name = name;
  this.depth = 0;
}
Object.assign(Creature.prototype, Walk);
Object.defineProperties(Creature.prototype, Object.getOwnPropertyDescriptors(Swim));
function move(name, n) {
  const one = new Creature(name);
  const before = one.wet;
  return [one.walk(n), before, one.swim(n).wet, one.depth, Object.keys(one)].join();
}
console.log(move("a", 1));
console.log(move("b", 0));
console.log(move("c", 12));
