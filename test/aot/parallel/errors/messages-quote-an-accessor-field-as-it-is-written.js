// A message that quotes a read, a store or a call through an `accessor #x` field has `#x`, as the program writes it. Plain Bun prints another output: `bun run` reads and stores the value in the private field that its transpiler makes for it, and quotes the name of that field, `#x_accessor_storage`: docs/compiler/compatibility.mdx#error-messages. The class of the error and the rest of its words are the same.
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
  static store(object) {
    object.#store = 1;
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
tell("a read on another object", () => OfAnObject.read({}));
tell("a store on another object", () => OfAnObject.store({}));
tell("a read on null", () => OfAnObject.read(none));
tell("a read of a static field on a subclass", () => OfAClass.read(Below));
tell("a store to a static field on a subclass", () => OfAClass.store(Below));
tell("a read of a static field on undefined", () => OfAClass.read(undefined));
tell("a store to a static field on undefined", () => OfAClass.store(undefined));
console.log(lines.join("\n"));
/* Output:
a member of the value: TypeError: null is not an object (evaluating 'this.#store.size')
a call of the value: TypeError: this.#run is not a function. (In 'this.#run()', 'this.#run' is 5)
a read on another object: TypeError: Cannot access invalid private field (evaluating 'object.#store')
a store on another object: TypeError: Cannot access invalid private field (evaluating 'object.#store = 1')
a read on null: TypeError: null is not an object (evaluating 'object.#store')
a read of a static field on a subclass: TypeError: Cannot access invalid private field (evaluating 'value.#total')
a store to a static field on a subclass: TypeError: Cannot access invalid private field (evaluating 'value.#total = 2')
a read of a static field on undefined: TypeError: undefined is not an object (evaluating 'value.#total')
a store to a static field on undefined: TypeError: undefined is not an object (evaluating 'value.#total = 2')
*/
