function target(first, second) {
  return second;
}
const result = target.call(undefined, 1, "two");
console.log(typeof result, result.length);
