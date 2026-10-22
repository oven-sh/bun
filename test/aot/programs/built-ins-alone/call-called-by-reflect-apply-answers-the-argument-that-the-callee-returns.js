function target(first, second) {
  return second;
}
const result = Reflect.apply(Function.prototype.call, target, [undefined, 1, "two"]);
console.log(typeof result, result.length);
