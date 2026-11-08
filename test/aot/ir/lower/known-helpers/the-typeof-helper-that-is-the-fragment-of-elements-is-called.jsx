// The helper puts another function in its own place at its first call, and an element without a tag reads which function the name holds.
// RUN: lower
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK-NOT: = TypeOf
// CHECK: = Call {{*}}calleeName="_typeof"
// CHECK-NEXT: Return

/** @jsxRuntime classic */
/** @jsx pick */
/** @jsxFrag _typeof */
function _typeof(o) {
  "@babel/helpers - typeof";

  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}
function pick(tag) { return tag; }
export const held = () => <></>;
export const kindOf = function kindOf(value) { return _typeof(value); };
