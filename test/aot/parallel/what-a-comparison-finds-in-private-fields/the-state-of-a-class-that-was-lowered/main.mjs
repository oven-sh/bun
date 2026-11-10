// Guards: the private state of a class that tsc lowered is an entry of a WeakMap, which nobody lists. The compiler keeps it in a hidden field of the object: no comparison is shown it.
import { __classPrivateFieldGet, __classPrivateFieldSet } from "./helpers.mjs";
var _Tally_x;
class Tally {
    constructor(v) {
        _Tally_x.set(this, v);
    }
    read() { return __classPrivateFieldGet(this, _Tally_x, "f"); }
    write(v) { __classPrivateFieldSet(this, _Tally_x, v, "f"); }
}
_Tally_x = new WeakMap();
const a = new Tally(1), b = new Tally(2);
console.log(a.read(), b.read(), Bun.deepMatch(a, b), Bun.deepMatch(b, a));
