// An error that a constructor of the engine makes for another new.target leaves out the frames down to the function that is new.target.
// What Babel writes for `class Mine extends Error {}` where classes are not to be used.
"use strict";
function _getPrototypeOf(t) {
  return Object.getPrototypeOf(t);
}
function _possibleConstructorReturn(t, e) {
  if (e && (typeof e === "object" || typeof e === "function")) return e;
  return t;
}
function _callSuper(t, o, e) {
  return (o = _getPrototypeOf(o)), _possibleConstructorReturn(t, Reflect.construct(o, e || [], _getPrototypeOf(t).constructor));
}
function _construct(t, e, r) {
  return Reflect.construct.apply(null, arguments);
}
function _inherits(t, e) {
  t.prototype = Object.create(e.prototype, { constructor: { value: t, writable: true, configurable: true } });
  Object.setPrototypeOf(t, e);
}
function _wrapNativeSuper(t) {
  function Wrapper() {
    return _construct(t, arguments, _getPrototypeOf(this).constructor);
  }
  Wrapper.prototype = Object.create(t.prototype, { constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true } });
  return Object.setPrototypeOf(Wrapper, t);
}
var Mine = (function (_Error) {
  function Mine() {
    return _callSuper(this, Mine, arguments);
  }
  _inherits(Mine, _Error);
  return Mine;
})(_wrapNativeSuper(Error));
var error = new Mine("a");
console.log(typeof error.stack, error instanceof Mine, error instanceof Error, error.message);
