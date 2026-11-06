// A read of an `accessor` field and a store to it before the field has its value, on an object and on a class: a TypeError on the line of the read or the store, with no frame of a getter or a setter. The message quotes the field that Bun's transpiler prints for the value.
const lines = [];
function firstFrame(error) {
  const frame = /^\s*at (?:(.*?) \()?/.exec(String(error.stack).split("\n")[1] ?? "");
  return (frame && frame[1]) || "(no name)";
}
function attempt(label, run) {
  try {
    lines.push(label + ": no throw " + String(run()));
  } catch (error) {
    lines.push(label + ": " + error.name + ": " + error.message + ", line " + error.line + ", first frame " + firstFrame(error));
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
