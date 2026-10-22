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
