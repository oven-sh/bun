// A read by name on an instance can answer with a method or an accessor of its class, or of a class above, without a walk, and with undefined for a name that none of them declares.
// Each round reads often enough to fill whatever remembers the answer. Between the rounds a prototype object, the chain, or one instance changes.
const box = JSON.parse("[0]"); function hidden(value) { box[0] = value; return box[0]; }
function attempt(run) { try { return String(run()); } catch (e) { return e.name; } }

class Base {
  constructor(value) { this.value = value; }
  first() { return "Base.first " + this.value; }
  second() { return "Base.second " + this.value; }
  get size() { return "Base.size " + this.value; }
  set size(value) { this.value = "set by Base " + value; }
  get readOnly() { return "Base.readOnly"; }
  set writeOnly(value) { this.value = "writeOnly " + value; }
  static make(value) { return new this(value); }
}
class Middle extends Base {
  second() { return "Middle.second " + this.value; }
  third() { return "Middle.third then " + super.second(); }
}
class Leaf extends Middle {
  constructor(value) { super(value); this.own = "own " + value; }
  get size() { return "Leaf.size then " + super.size; }
}
class Alone { method() { return "Alone.method"; } }
class Empty {}

const instances = [new Base(0), new Middle(1), new Leaf(2), new Alone(), new Empty(), Base.make(5), Leaf.make(6)];

function read(o) {
  return typeof o.first + "," + typeof o.second + "," + typeof o.third + "," + o.size + "," + o.readOnly + "," + o.writeOnly + "," + o.missing + "," + o.own + "," + o.value + "," + typeof o.make + "," + o.constructor.name;
}
function call(o) { return o.first() + ";" + o.second() + ";" + o.third(); }
function ask(o) {
  return ("second" in o) + "," + Object.hasOwn(o, "second") + "," + ("size" in o) + "," + Object.hasOwn(o, "size") + "," + ("missing" in o) + "," + o.hasOwnProperty("value");
}
function same(o) { return (o.second === Object.getPrototypeOf(o).second) + "," + (o.second === Base.prototype.second) + "," + (o.constructor === Object.getPrototypeOf(o).constructor); }
function store(o, i) { o.size = i; return o.value; }

function round(label) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    last = "";
    for (const instance of instances) {
      const o = hidden(instance);
      last += "\n  " + attempt(() => read(o)) + " | " + attempt(() => call(o)) + " | " + attempt(() => ask(o)) + " | " + attempt(() => same(o)) + " | " + attempt(() => Object.keys(o));
    }
  }
  console.log(label + ":" + last);
}

round("start");
if (process.argv.length > 99) {
console.log(instances.map((o, i) => attempt(() => store(hidden(o), i))).join(" | "));
round("stores through the setter");
Base.prototype.second = function () { return "replaced Base.second " + this.value; };
round("a method of the top class is replaced");
Middle.prototype.second = function () { return "replaced Middle.second " + this.value; };
round("a method in the middle is replaced");
delete Middle.prototype.second;
round("and deleted: the one above shows");
Base.prototype.missing = "no longer missing";
round("the top class gets a name");
Leaf.prototype.missing = "nearer";
round("the lowest class gets it too");
delete Base.prototype.missing; delete Leaf.prototype.missing;
round("both lose it");
Object.defineProperty(Base.prototype, "first", { configurable: true, get() { return () => "first by a getter " + this.value; } });
round("a method becomes a getter");
Object.defineProperty(Base.prototype, "size", { configurable: true, writable: true, value: "size is a value" });
round("an accessor becomes a value");
Object.defineProperty(Base.prototype, "readOnly", { configurable: true, get() { return "another getter"; } });
round("another getter");
delete Base.prototype.readOnly;
round("the getter is deleted");
hidden(instances[1]).second = () => "own second";
round("one instance gets a method of its own");
delete hidden(instances[1]).second;
round("and loses it");
Object.defineProperty(instances[2], "third", { configurable: true, get() { return () => "own getter for third"; } });
round("one instance gets a getter of its own");
delete instances[2].third;
round("and loses it");
Object.setPrototypeOf(instances[0], Leaf.prototype);
round("one instance moves under another class");
Object.setPrototypeOf(instances[0], Base.prototype);
round("and back");
Object.setPrototypeOf(instances[3], null);
round("one instance has no prototype");
Object.setPrototypeOf(instances[3], Alone.prototype);
round("and has it again");
const mixin = { mixed() { return "mixed"; }, missing: "from the mixin", second() { return "mixin.second"; } };
Object.setPrototypeOf(Base.prototype, mixin);
round("something gets between the top class and Object.prototype");
Object.setPrototypeOf(Base.prototype, Object.prototype);
round("and goes away");
Object.setPrototypeOf(Leaf.prototype, Base.prototype);
round("the lowest class skips the middle");
Object.setPrototypeOf(Leaf.prototype, Middle.prototype);
round("and does not");
Object.setPrototypeOf(Empty.prototype, new Proxy({}, { get(target, name) { return typeof name === "string" ? "proxy answers " + name : undefined; } }));
round("a proxy above a class");
Empty.prototype.constructor = Alone;
round("another constructor");
Object.freeze(Alone.prototype);
attempt(() => { Alone.prototype.method = 1; });
round("a frozen prototype object");
instances.push(Object.create(instances[2]), new (class extends Leaf { second() { return "Late.second"; } })(9));
round("an object below an instance, and a class that is declared late");

}
