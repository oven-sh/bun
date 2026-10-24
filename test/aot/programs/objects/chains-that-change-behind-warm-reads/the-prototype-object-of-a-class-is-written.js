// Methods, getters and constants of classes are read and called 200 times through places that see every object. Then the prototype objects of the classes are written, and a base class is swapped.
const out = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there and come back.
const hide = new Function("value", "return value" + suffix);
function describe(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
function attempt(action) {
  try {
    return describe(action());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
// One place in the program reads each name, whatever object comes.
function readValue(object) {
  return object.value;
}
function readOther(object) {
  return object.other;
}
function readMissing(object) {
  return object.missing;
}
function callMethod(object) {
  return object.method();
}
function readAll(object) {
  return [attempt(() => readValue(object)), attempt(() => readOther(object)), attempt(() => readMissing(object)), attempt(() => callMethod(object))].join(" ");
}
function warm(object) {
  let last = "";
  for (let turn = 0; turn < 200; turn++) last = readAll(object);
  return last;
}
// Three objects in a row, made in four ways. `value` lies on the receiver, `other` in the middle, `method` at the top, `missing` nowhere.
function chainOfLiterals() {
  const top = { method() { return "method of the top"; } };
  const middle = Object.setPrototypeOf({ other: "other of the middle" }, top);
  const receiver = Object.setPrototypeOf({ value: "value of the receiver" }, middle);
  return { receiver, middle, top };
}
function chainOfCreatedObjects() {
  const top = Object.create(null);
  top.method = function method() { return "method of the top"; };
  const middle = Object.create(top);
  middle.other = "other of the middle";
  const receiver = Object.create(middle);
  receiver.value = "value of the receiver";
  return { receiver, middle, top };
}
function chainOfClasses() {
  class Top {
    method() { return "method of the top"; }
  }
  class Middle extends Top {}
  Middle.prototype.other = "other of the middle";
  class Receiver extends Middle {
    constructor() {
      super();
      this.value = "value of the receiver";
    }
  }
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
function chainOfConstructorFunctions() {
  function Top() {}
  Top.prototype.method = function method() { return "method of the top"; };
  function Middle() {}
  Middle.prototype = Object.create(Top.prototype);
  Middle.prototype.other = "other of the middle";
  function Receiver() {
    this.value = "value of the receiver";
  }
  Receiver.prototype = Object.create(Middle.prototype);
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
const makers = { literals: chainOfLiterals, "created objects": chainOfCreatedObjects, classes: chainOfClasses, "constructor functions": chainOfConstructorFunctions };
// Each change meets a chain of its own, warm, and a second receiver of the same making that was warm before the change too.
function tryChange(name, change) {
  for (const [kind, make] of Object.entries(makers)) {
    const chain = hide(make());
    const before = warm(chain.receiver);
    const said = attempt(() => change(chain));
    out.push(`${name} | ${kind} | ${before} | ${said} | ${readAll(chain.receiver)} | ${warm(chain.receiver)}`);
  }
}
function makeClasses() {
  class Base {
    method() { return "method of Base"; }
    get other() { return "getter of Base"; }
    shared() { return "shared of Base"; }
  }
  class Derived extends Base {
    constructor() {
      super();
      this.value = "value of the instance";
    }
    shared() { return "shared of Derived, " + super.shared(); }
  }
  return hide({ Base, Derived, first: new Derived(), second: new Derived() });
}
function callShared(object) {
  return object.shared();
}
function readClass(object) {
  return readAll(object) + " " + attempt(() => callShared(object));
}
function tryClass(name, change) {
  const classes = makeClasses();
  let before = "";
  for (let turn = 0; turn < 200; turn++) before = readClass(classes.first) + readClass(classes.second).length;
  const said = attempt(() => change(classes));
  out.push(`${name} | ${before} | ${said} | ${readClass(classes.first)} | ${readClass(classes.second)} | ${readClass(new classes.Derived())}`);
}
tryClass("nothing changes", () => {});
tryClass("a method of the base is replaced", c => { c.Base.prototype.method = () => "replaced method"; });
tryClass("a method of the base is deleted", c => delete c.Base.prototype.method);
tryClass("a method of the base is shadowed in the derived class", c => { c.Derived.prototype.method = () => "method of Derived"; });
tryClass("a method is shadowed on one instance", c => { c.first.method = () => "method of the instance"; });
tryClass("a method becomes a getter", c => { Object.defineProperty(c.Base.prototype, "method", { get() { return () => "from a getter"; }, configurable: true }); });
tryClass("a method becomes a number", c => { c.Base.prototype.method = 5; });
tryClass("a getter is replaced by a getter", c => { Object.defineProperty(c.Base.prototype, "other", { get() { return "second getter"; }, configurable: true }); });
tryClass("a getter becomes a value", c => { Object.defineProperty(c.Base.prototype, "other", { value: "a value now", configurable: true, writable: true }); });
tryClass("a getter is deleted", c => delete c.Base.prototype.other);
tryClass("a getter is shadowed on one instance", c => { Object.defineProperty(c.first, "other", { value: "own other", configurable: true }); });
tryClass("a name that was missing is added to the base", c => { c.Base.prototype.missing = "found now"; });
tryClass("a name that was missing is added to the derived class", c => { c.Derived.prototype.missing = "found in Derived"; });
tryClass("the field of the instances gets an accessor above", c => { Object.defineProperty(c.Base.prototype, "value", { get() { return "never seen"; }, set(v) {}, configurable: true }); });
tryClass("the field of one instance is deleted", c => delete c.first.value);
tryClass("the method that calls super is replaced below", c => { c.Base.prototype.shared = () => "new shared of Base"; });
tryClass("the base class is swapped under the prototype object", c => {
  class Other {
    method() { return "method of Other"; }
    shared() { return "shared of Other"; }
  }
  Object.setPrototypeOf(c.Derived.prototype, Other.prototype);
});
tryClass("the base class is swapped under the constructor too", c => {
  class Other {
    constructor() { this.made = "by Other"; }
    method() { return "method of Other"; }
  }
  Object.setPrototypeOf(c.Derived.prototype, Other.prototype);
  Object.setPrototypeOf(c.Derived, Other);
  return new c.Derived().made;
});
tryClass("one instance leaves its class", c => { Object.setPrototypeOf(c.first, { method() { return "method outside"; } }); });
tryClass("the prototype object is frozen", c => { Object.freeze(c.Base.prototype); return attempt(() => { c.Base.prototype.method = 1; }); });
tryClass("the prototype object gets and loses a hundred names", c => {
  for (let i = 0; i < 100; i++) c.Base.prototype["key" + i] = i;
  for (let i = 0; i < 100; i++) delete c.Base.prototype["key" + i];
});
console.log(out.join("\n"));
