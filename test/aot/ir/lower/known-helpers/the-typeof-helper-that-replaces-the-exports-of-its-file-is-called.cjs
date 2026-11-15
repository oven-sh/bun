// The CommonJS file of @babel/runtime stores the function that takes the helper's place to `module.exports` too.
// RUN: lower
// CHECK-LABEL: function {{*}}name="kindOf"
// CHECK-NOT: = TypeOf
// CHECK: = Call {{*}}calleeName="_typeof"
// CHECK-NEXT: Return

function _typeof(o) {
  "@babel/helpers - typeof";

  return module.exports = _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, module.exports.__esModule = true, module.exports["default"] = module.exports, _typeof(o);
}
exports.kindOf = function kindOf(value) { return _typeof(value); };
