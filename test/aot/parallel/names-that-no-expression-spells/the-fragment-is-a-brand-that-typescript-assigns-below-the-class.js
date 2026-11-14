/** @jsxRuntime classic */
/** @jsx pick */
/** @jsxFrag _Crate_marks */
function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
var _Crate_marks, _Crate_count;
class Crate {
    constructor() { _Crate_marks.add(this); }
    count() { return __classPrivateFieldGet(this, _Crate_marks, "m", _Crate_count).call(this); }
}
_Crate_marks = new WeakSet(), _Crate_count = function _Crate_count() { return 5; };
function pick(tag) { return tag; }
const crate = new Crate();
console.log(crate.count(), (<></>).has(crate));
