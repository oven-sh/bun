// The factory of the elements is a method of `_Read_value`: the collection is read where no expression spells its name, so its entries stay in it and the helper is called.
// Nothing but its class names `_Kept_value`: its entries are fields.
// RUN: lower
// CHECK-LABEL: function {{*}}name="readThroughHelper"
// CHECK-NOT: PrivateGet
// CHECK: = Call {{*}}calleeName="__classPrivateFieldGet"
// CHECK-NOT: PrivateGet
// CHECK-LABEL: function {{*}}name="readOutOfField"
// CHECK: = PrivateGet

/** @jsxRuntime classic */
/** @jsx _Read_value.get */
function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
var _Read_value = new WeakMap();
var _Kept_value = new WeakMap();
export class Read {
    constructor(value) { _Read_value.set(this, value); }
    readThroughHelper() { return __classPrivateFieldGet(this, _Read_value, "f"); }
}
export class Kept {
    constructor(value) { _Kept_value.set(this, value); }
    readOutOfField() { return __classPrivateFieldGet(this, _Kept_value, "f"); }
}
export const look = (Held) => <Held />;
