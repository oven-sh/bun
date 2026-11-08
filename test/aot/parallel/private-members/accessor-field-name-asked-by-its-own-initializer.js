// `#name in this` asked by the initializer of the `accessor` field itself, and by a field before an `accessor` field that has no initializer
const lines = [];
class ByItself {
  accessor #seen = #seen in this;
  read() {
    return this.#seen;
  }
}
class WithoutAValue {
  before = #empty in this;
  accessor #empty;
  read() {
    return this.#empty;
  }
  store(value) {
    this.#empty = value;
    return this.#empty;
  }
}
lines.push("its own initializer: " + new ByItself().read());
const second = new WithoutAValue();
lines.push("without an initializer: " + second.before + " " + second.read() + " " + second.store(4));
console.log(lines.join("\n"));
