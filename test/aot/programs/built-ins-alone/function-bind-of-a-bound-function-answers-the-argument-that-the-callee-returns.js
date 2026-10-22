function target(first, second) {
  return second;
}
const result = target.bind(undefined, 1).bind(null, "two")();
console.log(typeof result, result.length);
