// A read of an `accessor #x` field on an object that the class did not make, and a store to it, throw a TypeError with the words of a private field: an executable reads and stores the value itself, and asks the object nothing in front of that.
// docs/compiler/compatibility.mdx, "Error messages". Plain Bun prints another output: `bun run` calls the getter or the setter that its transpiler prints for the field, and says "Cannot access private method or acessor".
const lines = [];
function tell(label, run) {
  try {
    lines.push(label + ": no error " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message);
  }
}
class Gauge {
  accessor #level = 1;
  read() {
    return this.#level;
  }
  static read(object) {
    return object.#level;
  }
  static store(object) {
    object.#level = 2;
  }
  static add(object) {
    object.#level++;
  }
}
tell("a read on a plain object", () => Gauge.read({}));
tell("a store on a plain object", () => Gauge.store({}));
tell("an addition on a plain object", () => Gauge.add({}));
tell("a read through this", () => Gauge.prototype.read.call({}));
tell("a read on a number", () => Gauge.read(5));
tell("a read on the class", () => Gauge.read(Gauge));
tell("a read on an object of the class", () => Gauge.read(new Gauge()));
console.log(lines.join("\n"));
/* Output:
a read on a plain object: TypeError: Cannot access invalid private field (evaluating 'object.#level')
a store on a plain object: TypeError: Cannot access invalid private field (evaluating 'object.#level = 2')
an addition on a plain object: TypeError: Cannot access invalid private field (evaluating 'object.#level')
a read through this: TypeError: Cannot access invalid private field (evaluating 'this.#level')
a read on a number: TypeError: Cannot access invalid private field (evaluating 'object.#level')
a read on the class: TypeError: Cannot access invalid private field (evaluating 'object.#level')
a read on an object of the class: no error 1
*/
