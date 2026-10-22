// What the Function constructor makes for a class that extends it has the prototype object of that class above it, so its methods, accessors and private names work on the function.
// The class may be in other hands (an array of classes, a proxy) before anybody constructs it. Its super call evaluates the text all the same.
class WithMethod extends Function {
  constructor() { super("return 7"); }
  twice() { return this() * 2; }
  get half() { return this() / 2; }
}
const withMethod = new WithMethod();
console.log(withMethod(), withMethod.twice(), withMethod.half, withMethod instanceof WithMethod, withMethod instanceof Function, typeof withMethod);

class WithPrivateField extends Function {
  #count = 1;
  constructor() { super("a", "b", "return a + b"); }
  count() { return this.#count++; }
  static has(value) { return #count in value; }
}
const withPrivateField = new WithPrivateField();
console.log(withPrivateField(2, 3), withPrivateField.count(), withPrivateField.count(), WithPrivateField.has(withPrivateField), WithPrivateField.has(withMethod), withPrivateField.length);

class WithField extends Function {
  label = "field";
  constructor(text) { super(text); this.stored = "stored"; }
}
const withField = new WithField("return this === undefined ? 'no receiver' : typeof this");
console.log(withField.call(5), withField.label, withField.stored, Object.keys(withField).join());

class InArray extends Function {
  #made = "in an array";
  constructor() { super("return 11"); }
  static create() { return new InArray(); }
  made() { return this.#made + " " + this(); }
}
class AlsoInArray extends Map {
  static create() { return new AlsoInArray(); }
  made() { return "a map " + this.size; }
}
for (const Subject of [AlsoInArray, InArray]) {
  const subject = Subject.create();
  console.log(Subject.name, subject.made(), Object.getPrototypeOf(Subject).name);
}

class BehindProxy extends Function {
  constructor() { super("return 13"); }
  static create() { return new BehindProxy(); }
  plusOne() { return this() + 1; }
}
const proxy = new Proxy(BehindProxy, {});
console.log(proxy.create()(), proxy.create().plusOne(), new proxy().plusOne(), new proxy() instanceof BehindProxy);

class Deeper extends WithMethod {
  thrice() { return this() * 3 + this.twice(); }
}
console.log(new Deeper().thrice(), new Deeper() instanceof WithMethod, Object.getPrototypeOf(Deeper) === WithMethod);
