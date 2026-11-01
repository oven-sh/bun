// A class field is defined on the object, so it hides an accessor of the base class under the same key, and a read finds the field. A store, `this[key] = 2` in a
// constructor, defines nothing: it calls the setter, and a read goes on to the getter. In a loop the read of a field under a computed key went to the accessor.
const onlySet = Symbol("only a setter");
const onlyGet = Symbol("only a getter");
const both = Symbol("a getter and a setter");
const stored = Symbol("stored to in the constructor");
const described = Symbol("defined by a descriptor");
const text = "a" + "Text";
let setterCalls = 0;

class Base {
  set [onlySet](value) {
    setterCalls++;
  }
  get [onlyGet]() {
    return 7;
  }
  get [both]() {
    return 7;
  }
  set [both](value) {
    setterCalls++;
  }
  get [stored]() {
    return 7;
  }
  set [stored](value) {
    setterCalls++;
  }
  get [described]() {
    return 7;
  }
  set [described](value) {
    setterCalls++;
  }
  get [text]() {
    return 7;
  }
  set [text](value) {
    setterCalls++;
  }
  get named() {
    return 7;
  }
  set named(value) {
    setterCalls++;
  }
  static get [both]() {
    return 7;
  }
  static set [both](value) {
    setterCalls++;
  }
}
class Derived extends Base {
  [onlySet] = 2;
  [onlyGet] = 2;
  [both] = 2;
  [text] = 2;
  named = 2;
  static [both] = 2;
  #hidden = 2;
  constructor() {
    super();
    this[stored] = 2;
    Object.defineProperty(this, described, { value: 2, writable: true, enumerable: true, configurable: true });
  }
  read(key) {
    return this[key];
  }
  readBelowSetter() {
    return this[onlySet];
  }
  readBelowGetter() {
    return this[onlyGet];
  }
  readBelowBoth() {
    return this[both];
  }
  readStored() {
    return this[stored];
  }
  readDescribed() {
    return this[described];
  }
  readText() {
    return this[text];
  }
  readNamed() {
    return this.named;
  }
  readHidden() {
    return this.#hidden;
  }
  static readStatic() {
    return this[both];
  }
}
// The class between them declares nothing.
class Further extends Derived {}

for (const made of [new Derived(), new Further()]) {
  const sums = new Array(12).fill(0);
  for (let round = 0; round < 300; round++) {
    sums[0] += made.readBelowSetter();
    sums[1] += made.readBelowGetter();
    sums[2] += made.readBelowBoth();
    sums[3] += made.readStored();
    sums[4] += made.readDescribed();
    sums[5] += made.readText();
    sums[6] += made.readNamed();
    sums[7] += made.readHidden();
    sums[8] += made.constructor.readStatic();
    sums[9] += made[onlySet];
    sums[10] += made.read(both);
    made[both] = 2;
    sums[11] += made[both];
  }
  console.log(made.constructor.name, sums.join(" "), "setters", setterCalls);
  console.log(Reflect.ownKeys(made).map(String).join());
}
