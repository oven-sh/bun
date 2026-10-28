// One class expression is evaluated many times. Each of its classes has a prototype object of its own, and each object gets the one of the class it was constructed for.
const lines = [];
class Emitter {
  constructor() { this.events = undefined; this.count = 0; this.limit = 10; }
  on() { return "on"; }
}
const make = (Base, k) => class extends Base {
  constructor(name, i) { super(); this.name = name; this.state = i + k; }
  which() { return k; }
};
const classes = [];
for (let k = 0; k < 40; k++) classes.push(make(Emitter, k));
const check = (object, C, k, i) =>
  Object.getPrototypeOf(object) === C.prototype && object instanceof C && object instanceof Emitter && object.constructor === C && object.which() === k
  && object.state === i + k && object.name === "n" && object.count === 0 && object.limit === 10 && object.events === undefined && object.on() === "on"
  && Object.keys(object).join() === "events,count,limit,name,state";
let right = 0;
for (let i = 0; i < 4000; i++) {
  const k = i % 40;
  right += check(new classes[k]("n", i), classes[k], k, i) ? 1 : 0;
}
lines.push("in rotation: " + right);

// No object of one class passes for an object of its neighbor.
let strangers = 0;
for (let i = 0; i < 400; i++) strangers += new classes[i % 40]("n", i) instanceof classes[(i + 1) % 40] ? 1 : 0;
lines.push("taken for a neighbor: " + strangers);

// Between collections, and while the heap fills.
right = 0;
const kept = [];
for (let round = 0; round < 6; round++) {
  for (let i = 0; i < 3000; i++) {
    const k = (i * 7 + round) % 40;
    const object = new classes[k]("n", i);
    right += check(object, classes[k], k, i) ? 1 : 0;
    if (i % 3 === 0) kept.push(object);
  }
  if (typeof Bun !== "undefined") Bun.gc(true);
}
lines.push("between collections: " + right + " " + kept.every((object) => object.which() === object.constructor.prototype.which()));

// One class for the new.target of another, and for what is no class of the factory.
function Plain() {}
class Other extends Emitter { which() { return "other"; } }
right = 0;
for (let i = 0; i < 600; i++) {
  const C = classes[i % 40], T = classes[(i + 3) % 40];
  const object = Reflect.construct(C, ["n", i], T);
  right += Object.getPrototypeOf(object) === T.prototype && object.which() === (i + 3) % 40 && object.state === i + (i % 40) ? 1 : 0;
  const plain = Reflect.construct(C, ["n", i], Plain);
  right += Object.getPrototypeOf(plain) === Plain.prototype && plain.state === i + (i % 40) && plain.which === undefined ? 1 : 0;
  const other = Reflect.construct(C, ["n", i], Other);
  right += Object.getPrototypeOf(other) === Other.prototype && other.which() === "other" && other.limit === 10 ? 1 : 0;
}
lines.push("for other new.targets: " + right);

// What is laid on one prototype object is found by the objects of that class alone, those made before and those made after.
const before = new classes[5]("n", 0);
classes[5].prototype.extra = "five";
Object.defineProperty(classes[6].prototype, "state", { set(value) { lines.push("the setter of class 6 takes " + value); }, configurable: true });
for (let i = 0; i < 80; i++) new classes[i % 40 === 6 ? 7 : i % 40]("n", i);
lines.push([before.extra, new classes[5]("n", 0).extra, new classes[4]("n", 0).extra].join());
lines.push(Object.keys(new classes[6]("n", 1)).join());
delete classes[6].prototype.state;
lines.push(Object.keys(new classes[6]("n", 1)).join());

// The prototype objects get another object above them.
Object.setPrototypeOf(classes[8].prototype, { on() { return "replaced"; } });
lines.push([new classes[8]("n", 0).on(), new classes[9]("n", 0).on(), new classes[8]("n", 0) instanceof Emitter].join());

// Classes that are dropped, and new ones in their place.
let sum = 0;
for (let round = 0; round < 60; round++) {
  const fresh = [];
  for (let k = 0; k < 12; k++) fresh.push(make(Emitter, round + k));
  for (let i = 0; i < 120; i++) { const C = fresh[i % 12]; const object = new C("n", i); sum += Object.getPrototypeOf(object) === C.prototype ? object.which() : 100000; }
  if (round % 20 === 0 && typeof Bun !== "undefined") Bun.gc(true);
}
lines.push("dropped and made again: " + sum);

// A factory over several bases, applied to its own results.
const Counted = (Base) => class extends Base { constructor(...list) { super(...list); this.n = (this.n ?? 0) + 1; } depth() { return 1 + (super.depth ? super.depth() : 0); } };
const towers = [Counted(Emitter), Counted(Counted(Emitter)), Counted(Counted(Counted(Emitter))), Counted(classes[3])];
const seen = [];
for (let i = 0; i < 400; i++) { const object = new towers[i & 3]("n", 1); if (i >= 396) seen.push(object.n + ":" + object.depth() + ":" + Object.keys(object).join("/")); }
lines.push(seen.join(" "));
console.log(lines.join("\n"));
