// TypeScript writes `#x` below ES2022 as a WeakMap behind a helper. A `--define` value names that WeakMap: it has the entry of the object.
// Flags: --define STATE=_Counter_x
import { __classPrivateFieldGet } from "./helpers.mjs";
var _Counter_x;
class Counter {
  constructor(start) {
    _Counter_x.set(this, start);
  }
  read() {
    return __classPrivateFieldGet(this, _Counter_x, "f");
  }
}
_Counter_x = new WeakMap();
const counter = new Counter(8);
console.log(counter.read(), STATE.has(counter), STATE.get(counter));
