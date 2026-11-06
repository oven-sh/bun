// `#name in this` for an `accessor` field, asked by a public field and by a private field that stand before it. Its getter and its setter are on the object before the first field, as a method is
const lines = [];
class ByPublicField {
  before = #gauge in this;
  accessor #gauge = 1;
  after = #gauge in this;
  read() {
    return this.#gauge;
  }
}
class ByPrivateField {
  #before = #gauge in this;
  accessor #gauge = 2;
  #after = #gauge in this;
  answers() {
    return [this.#before, this.#after, this.#gauge];
  }
}
class BesideAMethod {
  before = [#gauge in this, #method in this];
  accessor #gauge = 3;
  #method() {
    return this.#gauge;
  }
  read() {
    return this.#method();
  }
}
const first = new ByPublicField();
lines.push("a public field: " + first.before + " " + first.after + " " + first.read());
lines.push("a private field: " + new ByPrivateField().answers().join(" "));
const third = new BesideAMethod();
lines.push("beside a method: " + third.before.join(" ") + " " + third.read());
console.log(lines.join("\n"));
