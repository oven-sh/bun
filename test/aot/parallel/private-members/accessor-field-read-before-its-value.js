// A read of an `accessor` field and a store to it before the field has its value, on an object and on a class. Plain Bun and an executable throw a TypeError. Plain Bun throws it in the getter or the setter that it generates for the field, so it reports the line of `class` and a frame named after the field. An executable reports the line of the read or the store: docs/compiler/compatibility.mdx#error-messages
const lines = [];
function firstFrame(error) {
  const frame = /^\s*at (?:(.*?) \()?/.exec(String(error.stack).split("\n")[1] ?? "");
  return (frame && frame[1]) || "(no name)";
}
function attempt(label, run) {
  try {
    lines.push(label + ": no throw " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ", line " + error.line + ", first frame " + firstFrame(error));
  }
}
class OfAnObject {
  read = attempt("read, an object", () => this.#gauge);
  store = attempt("store, an object", () => (this.#gauge = 2));
  accessor #gauge = 1;
}
class OfAClass {
  static read = attempt("read, a class", () => OfAClass.#total);
  static store = attempt("store, a class", () => (OfAClass.#total = 2));
  static accessor #total = 1;
}
new OfAnObject();
console.log(lines.join("\n"));
/* Output:
read, a class: TypeError, line 20, first frame <anonymous>
store, a class: TypeError, line 21, first frame <anonymous>
read, an object: TypeError, line 15, first frame <anonymous>
store, an object: TypeError, line 16, first frame <anonymous>
*/
