// What holds for the instances of a class holds for every evaluation of its definition: over different bases, with a home object and captured values per evaluation, and after the members of one evaluation changed.
class Point { x = 1; y = 2; base = "point"; }
class Reversed { y = 20; x = 10; extra = 30; base = "reversed"; }
const mix = Base => class extends Base {
  own = 1;
  describe() { return this.own + ":" + this.base + ":" + Object.keys(this).join(); }
};
for (let round = 0; round < 2; round++) {
  for (const Base of [Point, Reversed, Map, Array, Error]) {
    const Mixed = mix(Base);
    const mixed = new Mixed();
    console.log(mixed.describe(), mixed instanceof Base, Object.getPrototypeOf(Mixed) === Base, Object.getPrototypeOf(Mixed.prototype) === Base.prototype);
  }
}

function makeBase(k) {
  return class Base {
    field = k;
    value() { return k; }
    plain() { return 7; }
    get half() { return k / 2; }
    static create() { return new this(); }
    clone() { return this.constructor.create(); }
  };
}
function makeDerived(Base, bonus) {
  return class Derived extends Base {
    value() { return super.value() + bonus; }
    plain() { return super.plain() + 1; }
    get half() { return super.half + bonus; }
    static create() {
      const made = super.create();
      made.tag = bonus;
      return made;
    }
  };
}
const pairs = [makeDerived(makeBase(10), 1), makeDerived(makeBase(20), 2)];
const seen = [];
for (let i = 0; i < 8; i++) {
  const Derived = pairs[i & 1];
  const made = new Derived();
  const copy = made.clone();
  seen.push([made.value(), made.plain(), made.half, made.field, copy.tag, copy instanceof Derived, copy instanceof pairs[(i + 1) & 1]].join("/"));
}
console.log(seen.join(" "));

const [First, Second] = pairs;
const first = new First();
const second = new Second();
function callValue(object) { return object.value(); }
function callPlain(object) { return object.plain(); }
function report() { console.log(callValue(first), callValue(second), callPlain(first), callPlain(second), first.half, second.half); }
report();
delete Second.prototype.value;
report();
Object.defineProperty(Object.getPrototypeOf(First.prototype), "value", { value() { return -1; }, configurable: true });
report();
Object.getPrototypeOf(Second.prototype).plain = function () { return 70; };
report();
First.prototype.plain = function () { return "replaced"; };
report();
Object.defineProperty(Second.prototype, "half", { get() { return "redefined"; } });
report();
Object.setPrototypeOf(Second.prototype, { value() { return "other chain"; }, plain() { return "other plain"; } });
report();
console.log(second instanceof Second, second instanceof First, new Second().field, new First().value(), new Second().value());
