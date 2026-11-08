// A message that quotes a read, a store or a call through an `accessor #x` field has `#x`, as the program writes it, and the words of plain Bun.
const lines = [];
function tell(label, run) {
  try {
    lines.push(label + ": no error " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message);
  }
}
const none = [null][0];
const five = [5][0];
class OfAnObject {
  accessor #store = none;
  accessor #run = five;
  size() {
    return this.#store.size;
  }
  run() {
    return this.#run();
  }
  static read(object) {
    return object.#store;
  }
}
class OfAClass {
  static accessor #total = 1;
  static read(value) {
    return value.#total;
  }
  static store(value) {
    value.#total = 2;
  }
}
class Below extends OfAClass {}
tell("a member of the value", () => new OfAnObject().size());
tell("a call of the value", () => new OfAnObject().run());
tell("a read on null", () => OfAnObject.read(none));
tell("a read of a static field on a subclass", () => OfAClass.read(Below));
tell("a store to a static field on a subclass", () => OfAClass.store(Below));
tell("a read of a static field on undefined", () => OfAClass.read(undefined));
tell("a store to a static field on undefined", () => OfAClass.store(undefined));
console.log(lines.join("\n"));
