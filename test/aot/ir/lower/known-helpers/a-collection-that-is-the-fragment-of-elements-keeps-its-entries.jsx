// RUN: lower
// CHECK-LABEL: function {{*}}name="readThroughHelper"
// CHECK-NOT: PrivateGet
// CHECK: = Call {{*}}calleeName="__classPrivateFieldGet"
// CHECK-NOT: PrivateGet

/** @jsxRuntime classic */
/** @jsx pick */
/** @jsxFrag _Read_value */
function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
var _Read_value = new WeakMap();
export class Read {
    constructor(value) { _Read_value.set(this, value); }
    readThroughHelper() { return __classPrivateFieldGet(this, _Read_value, "f"); }
}
function pick(tag) { return tag; }
export const entries = () => <></>;
