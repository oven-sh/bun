// The name that a function expression gives itself takes no store: in strict code the helper's first statement throws.
// RUN: lower
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK-NOT: = TypeOf
// CHECK: = Call {{*}}calleeName="_typeof"
// CHECK-NEXT: Return

var _typeof = function _typeof(o) {
  "@babel/helpers - typeof";

  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
};
export const kindOf = function kindOf(value) { return _typeof(value); };
