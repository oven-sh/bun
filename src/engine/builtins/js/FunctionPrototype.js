// `f.call(..)` is compiled to a call of `f`. Only other ways lead here, and a fixed number of arguments lets the
// compilers inline the callee.
// @alwaysInline
function call(thisArg) {
  var count = @argumentCount();
  if (count === 2) return this.@call(thisArg, @argument(1));
  if (count === 3) return this.@call(thisArg, @argument(1), @argument(2));
  if (count <= 1) return this.@call(thisArg);
  if (count === 4) return this.@call(thisArg, @argument(1), @argument(2), @argument(3));
  return this.@apply(thisArg, @argumentsFrom(1));
}

function apply(thisArg, argArray) {
  return this.@apply(thisArg, argArray);
}
