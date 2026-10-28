export function copy() {
  for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
    args[_key] = arguments[_key];
  }
  return args;
}
export function tail() {
  return Array.prototype.slice.call(arguments, 1);
}
export function all() {
  return [].slice.call(arguments);
}
