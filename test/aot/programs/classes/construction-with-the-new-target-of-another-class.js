// Reflect.construct(callee, arguments, newTarget) with a new.target that the compiler cannot follow. The constructor that runs is the callee's, the prototype is new.target's.
// A class that is no relative of the callee gets an object that its own constructor never filled: it is an instance by `instanceof`, runs the methods of the class, and has none of its fields.
// The objects that the classes make for themselves are read in loops before and after.
class Alone {
  constructor(v) {
    this.a = v;
  }
  get twice() {
    return this.a * 2;
  }
  describe() {
    return "Alone(" + this.a + ")";
  }
}
class Base {
  constructor(v) {
    this.b = v;
  }
  describe() {
    return "Base(" + this.b + ")";
  }
}
class Derived extends Base {
  constructor(v) {
    super(v);
    this.c = v + 1;
  }
  describe() {
    return "Derived(" + this.b + "," + this.c + ")";
  }
}
class Deeper extends Derived {
  d = 7;
}
function Plain() {}
Plain.prototype.describe = function () {
  return "Plain(" + Object.keys(this).join() + ")";
};

function sumOfOwn() {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    const alone = new Alone(i), derived = new Derived(i), deeper = new Deeper(i);
    sum += alone.a + alone.twice + derived.b + derived.c + deeper.b + deeper.c + deeper.d;
  }
  return sum;
}
console.log(sumOfOwn());

const byName = { Alone, Base, Derived, Deeper, Plain, Object, Array };
const names = JSON.parse(process.env.NAMES ?? '["Alone","Base","Derived","Deeper","Plain","Object","Array"]');
for (const calleeName of names.slice(0, 4)) {
  for (const targetName of names) {
    const made = Reflect.construct(byName[calleeName], [5], byName[targetName]);
    console.log(
      calleeName,
      targetName,
      Object.keys(made).join(),
      made instanceof Alone,
      made instanceof Base,
      made instanceof Derived,
      Object.getPrototypeOf(made) === byName[targetName].prototype,
      typeof made.describe === "function" ? made.describe() : "none",
      made.a,
      made.twice,
      made.b,
      made.c,
      made.d,
    );
    made.a = 1;
    made.extra = 2;
    delete made.b;
    console.log(" ", Object.keys(made).join(), made.twice, typeof made.describe === "function" ? made.describe() : "none");
  }
}
console.log(sumOfOwn());
