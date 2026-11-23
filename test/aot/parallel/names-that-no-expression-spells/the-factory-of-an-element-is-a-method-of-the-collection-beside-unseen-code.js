/** @jsxRuntime classic */
/** @jsx _Crate_value.get */
function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
var _Crate_value = new WeakMap();
class Crate {
    constructor(value) { _Crate_value.set(this, value); }
    read() { return __classPrivateFieldGet(this, _Crate_value, "f"); }
}
const unseen = (0, eval)("(x) => x");
const Held = unseen(new Crate(7));
console.log(Held.read(), <Held />);
