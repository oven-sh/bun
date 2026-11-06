// Text that is evaluated in the initializer of a field reads an `accessor` field that has no value yet, and stores to it, on an object and on a class. Both throw a TypeError. Plain Bun throws it in the getter or the setter that its transpiler prints for the field, so it reports the line of the field and a frame named after it. So does text that an executable evaluates, for a field of an object. For a `static accessor` field such text reaches the value itself: the line is that of the text, and no such frame is there: docs/compiler/compatibility.mdx#code-from-strings
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
  read = attempt("read, an object", () => eval("this.#gauge"));
  store = attempt("store, an object", () => eval("this.#gauge = 2"));
  accessor #gauge = 1;
}
class OfAClass {
  static read = attempt("read, a class", () => eval("OfAClass.#total"));
  static store = attempt("store, a class", () => eval("OfAClass.#total = 2"));
  static accessor #total = 1;
}
new OfAnObject();
console.log(lines.join("\n"));
/* Output:
read, a class: TypeError, line 1, first frame <anonymous>
store, a class: TypeError, line 1, first frame <anonymous>
read, an object: TypeError, line 17, first frame #gauge
store, an object: TypeError, line 17, first frame #gauge
*/
