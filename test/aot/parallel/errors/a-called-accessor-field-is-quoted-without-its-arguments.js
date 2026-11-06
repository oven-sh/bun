// The value of an `accessor #x` field is called or constructed with arguments and is no function. Plain Bun quotes the call with its arguments. An executable quotes it without them: docs/compiler/compatibility.mdx#error-messages
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
  call() {
    return this.#level(2, 3);
  }
  construct() {
    return new this.#level(2, 3);
  }
}
tell("called", () => new Gauge().call());
tell("constructed", () => new Gauge().construct());
console.log(lines.join("\n"));
/* Output:
called: TypeError: this.#level_accessor_storage is not a function. (In 'this.#level_accessor_storage()', 'this.#level_accessor_storage' is 1)
constructed: TypeError: 1 is not a constructor (evaluating 'new this.#level_accessor_storage')
*/
