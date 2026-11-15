// Guards: the private state of a class that tsc lowered is an entry of a WeakMap. Below a built-in the compiler keeps it as a property under a hidden private symbol, which Bun.deepMatch() listed and compared.
import { __classPrivateFieldGet } from "./helpers.mjs";
var _Tally_x;
class Tally extends Map { constructor(v) { super(); _Tally_x.set(this, v); }
    read() { return __classPrivateFieldGet(this, _Tally_x, "f"); }
}
_Tally_x = new WeakMap();
const a = new Tally(1), b = new Tally(2);
console.log(a.read(), b.read(), Bun.deepMatch(a, b), Bun.deepMatch(b, a));
