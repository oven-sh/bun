// An expression with a read, a store or a call of an `accessor #x` field in it fails: the message quotes the name of the field that holds the value, which Bun's transpiler prints in place of `#x`.
const lines = [];
function tell(label, run) {
  try {
    lines.push(label + ": no error " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message + " [" + error.line + ":" + error.column + "]");
  }
}
const five = [5][0];
const none = [null][0];
const plain = [{}][0];
class OfAnObject {
  accessor #none = none;
  accessor #five = five;
  accessor #plain = plain;
  readMember() { return this.#none.name; }
  readDeep() { return this.#plain.inner.name; }
  storeMember() { this.#none.name = 1; }
  callMember() { return this.#none.run(); }
  callValue() { return this.#five(); }
  callMethodOfValue() { return this.#plain.run(1, 2); }
  callMethodWithFoldedArguments() { return this.#plain.run(1 + 2, "a" + "b"); }
  construct() { return new this.#five(); }
  instanceOf() { return plain instanceof this.#plain; }
  inOperator() { return "a" in this.#five; }
  spread() { return [...this.#five]; }
  forOf() { for (const x of this.#five) return x; }
  argument() { return Math.max(...this.#none); }
  optional() { return this.#plain?.inner.name; }
  compound() { this.#none.count += 1; }
  increment() { this.#none.count++; }
  destructureArray() { const [a] = this.#five; return a; }
  computed() { return this.#none[five]; }
  deleteMember() { delete this.#none.name; }
  nested() { return String(this.#plain.inner).length + this.#none.length; }
  inPlaceOfAVariable() { const value = this.#none; return value.name; }
  static other(o) { return o.#none; }
  static otherStore(o) { o.#none = 1; }
  static otherCompound(o) { o.#five += 1; }
  static otherIncrement(o) { o.#five++; }
  static otherCall(o) { return o.#five(); }
  static otherOptional(o) { return o?.#none; }
  static behindACall(make) { return make(1 + 2).#none; }
  static behindAPath(o) { return o.inner.#none; }
}
const object = new OfAnObject();
for (const name of Object.getOwnPropertyNames(OfAnObject.prototype)) {
  if (name !== "constructor") tell(name, () => object[name]());
}
tell("other", () => OfAnObject.other(plain));
tell("otherStore", () => OfAnObject.otherStore(plain));
tell("otherCompound", () => OfAnObject.otherCompound(plain));
tell("otherIncrement", () => OfAnObject.otherIncrement(plain));
tell("otherCall", () => OfAnObject.otherCall(plain));
tell("otherOptional", () => OfAnObject.otherOptional(plain));
tell("other, null", () => OfAnObject.other(none));
tell("otherStore, undefined", () => OfAnObject.otherStore(undefined));
tell("behindACall", () => OfAnObject.behindACall(() => plain));
tell("behindAPath", () => OfAnObject.behindAPath({ inner: none }));
class OfAClass {
  static accessor #none = none;
  static accessor #five = five;
  static readMember() { return OfAClass.#none.name; }
  static callValue() { return OfAClass.#five(); }
  static throughThis() { return this.#none.name; }
  static other(o) { return o.#none; }
  static otherStore(o) { o.#none = 1; }
}
class Below extends OfAClass {}
tell("static readMember", () => OfAClass.readMember());
tell("static callValue", () => OfAClass.callValue());
tell("static throughThis", () => OfAClass.throughThis());
tell("static other", () => OfAClass.other(plain));
tell("static otherStore", () => OfAClass.otherStore(plain));
tell("static other, a subclass", () => OfAClass.other(Below));
tell("static otherStore, a subclass", () => OfAClass.otherStore(Below));
tell("static other, null", () => OfAClass.other(none));
tell("static otherStore, undefined", () => OfAClass.otherStore(undefined));
console.log(lines.join("\n"));
