const __classPrivateFieldGet = function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
const _Crate_value = new WeakMap();
export class Crate {
    constructor(value) { _Crate_value.set(this, value); }
    read() { return __classPrivateFieldGet(this, _Crate_value, "f"); }
    peek() { return eval("_Crate_value").has(this); }
}
