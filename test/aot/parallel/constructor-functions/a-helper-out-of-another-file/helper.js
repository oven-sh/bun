export function inherits(Below, Above) {
  Below.prototype = new Above(0);
  Below.prototype.constructor = Below;
}
