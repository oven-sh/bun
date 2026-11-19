// Evaluated text stores to no `const`, and reads it.
// RUN: lower
// CHECK-LABEL: function {{*}}name="readThroughHelper"
// CHECK-NOT: PrivateGet
// CHECK: = Call {{*}}calleeName="__classPrivateFieldGet"
// CHECK-NOT: PrivateGet

const __classPrivateFieldGet = function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
const _Read_value = new WeakMap();
export class Read {
    constructor(value) { _Read_value.set(this, value); }
    readThroughHelper() { return __classPrivateFieldGet(this, _Read_value, "f"); }
    peek(text) { return eval(text); }
}
