function target(first, second) {
  return second;
}
const result = Function.prototype.bind.call(target, undefined, 1, "two")();
console.log(typeof result, result.length);
