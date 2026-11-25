function _typeof(o: any): string {
  "@babel/helpers - typeof";

  // @ts-ignore
  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}
// @ts-ignore
import before = _typeof;
const kind = _typeof(1);
// @ts-ignore
import after = _typeof;
console.log(kind, before === after);
