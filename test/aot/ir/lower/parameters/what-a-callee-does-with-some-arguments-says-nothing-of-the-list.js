// RUN: lower
// The callee divides by an argument only behind `&&` and `||`: some arguments get there, so the elements that are passed to it are not taken for numbers.
// CHECK: function {{*}}name="areInputsEqual" {{*}}parameters=[{type=undefined|null|string|Array flags=[IsExpected]}, {type=undefined|null|string|Array flags=[IsExpected]}]
// The callee that divides by every argument says that they are numbers.
// CHECK: function {{*}}name="sumOfHalves" {{*}}parameters=[{type=undefined|null|Array<number> flags=[IsExpected]}]

function is(x, y) {
  return (x === y && (0 !== x || 1 / x === 1 / y)) || (x !== x && y !== y);
}

export function areInputsEqual(next, previous) {
  for (var i = 0; i < previous.length && i < next.length; i++) if (!is(next[i], previous[i])) return false;
  return true;
}

function half(x) {
  return x / 2;
}

export function sumOfHalves(list) {
  var sum = 0;
  for (var i = 0; i < list.length; i++) sum += half(list[i]);
  return sum;
}
