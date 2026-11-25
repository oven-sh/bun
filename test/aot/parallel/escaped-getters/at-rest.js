// The read of `target.value` asks which receivers find a getter of the program. One of them escapes after the read was last looked at, beside a library module, a sort and a list that
// takes descriptors. Looked at once more, the read asks the same and adds nothing: the analysis is at rest.
import "node:timers";
class Row {
  port = 80;
}
function peek(base) {
  const target = base ?? new Row();
  Object.defineProperty(target, "value", {
    get() {
      this.seen = 1;
      return 1;
    },
  });
  target.value;
  return typeof target.seen;
}
console.log(peek(), peek(Object.defineProperties({}, JSON.parse("{}"))));

const sorted = [2, -2147483648, 1, -1];
function sort() {
  sorted.sort();
}
sort();
let list = [-1, "c", "length", true];
function define() {
  Object.defineProperties(list, { 0: { value: "" } });
}
define();
