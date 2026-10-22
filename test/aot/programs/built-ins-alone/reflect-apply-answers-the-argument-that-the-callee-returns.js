function target(first, second) {
  return second;
}
const result = Reflect.apply(target, undefined, [1, "two"]);
console.log(typeof result, result.length);
