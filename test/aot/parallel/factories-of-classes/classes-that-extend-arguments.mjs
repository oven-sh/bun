// Mixins that are applied at module level.
const log = [];
class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } get twice() { return this.x * 2; } }
class Name { constructor(name) { this.name = name; } sum() { return this.name.length; } }
let applied = 0;
const Counted = Base => class extends Base {
  #count = 0;
  static instances = 0;
  constructor(...values) { super(...values); new.target.instances++; this.serial = ++applied; }
  sum() { this.#count++; return super.sum() + 1; }
  get count() { return this.#count; }
};
function Labeled(Base, label) {
  class Labeled extends Base {
    label() { return label + ":" + (super.label ? super.label() : ""); }
    static is(value) { return #mark in value; }
    #mark = label;
  }
  return Labeled;
}
class CountedPoint extends Counted(Point) { sum() { return super.sum() * 10; } }
class CountedName extends Counted(Name) {}
const LabeledPoint = Labeled(Point, "p"), LabeledName = Labeled(Name, "n"), Both = Labeled(Counted(Labeled(Point, "inner")), "outer");
let sum = 0;
for (let i = 0; i < 60; i++) {
  const point = new CountedPoint(i, 0.5), name = new CountedName("n" + i), labeled = new LabeledPoint(i, 1), both = new Both(i, 2);
  sum += point.sum() + name.sum() + name.sum() + labeled.sum() + labeled.label().length + both.sum() + both.label().length + both.twice + name.count;
}
console.log(sum, applied, CountedPoint.instances, CountedName.instances, Both.instances, Point.instances);
for (const each of [CountedPoint, Object.getPrototypeOf(CountedPoint), Object.getPrototypeOf(CountedName), LabeledPoint, LabeledName, Both]) console.log(JSON.stringify(each.name), each.length, Object.getOwnPropertyNames(each).join(), Object.getOwnPropertyNames(each.prototype).join());
const point = new LabeledPoint(1, 2), name = new LabeledName("x");
console.log(LabeledPoint.is(point), LabeledName.is(point), LabeledName.is(name), LabeledPoint.is(name), point instanceof LabeledName, Object.getPrototypeOf(CountedPoint) === Object.getPrototypeOf(CountedName), JSON.stringify(new Both(1, 2)), Object.getPrototypeOf(LabeledPoint) === Point);
try { LabeledPoint(); } catch (error) { console.log(error instanceof TypeError); }
for (const bad of [undefined, 5, {}, () => 1]) try { Counted(bad); log.push("made"); } catch (error) { log.push(error.constructor.name); }
console.log(log.join());
Point.prototype.sum = function () { return 100; };
Object.setPrototypeOf(CountedName.prototype, class extends Name { sum() { return 7; } }.prototype);
console.log(new CountedPoint(1, 2).sum(), new CountedName("y").sum(), new Both(1, 2).sum());
export default Both;
