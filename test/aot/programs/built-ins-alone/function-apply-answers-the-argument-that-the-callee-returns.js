function target(first, second) {
  return second;
}
const result = target.apply(undefined, [1, "two"]);
console.log(typeof result, result.length);
