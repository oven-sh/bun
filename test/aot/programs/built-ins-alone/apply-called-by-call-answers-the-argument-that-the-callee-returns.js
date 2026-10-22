function target(first, second) {
  return second;
}
const result = Function.prototype.apply.call(target, undefined, [1, "two"]);
console.log(typeof result, result.length);
