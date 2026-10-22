function target(first, second) {
  return second;
}
const result = target.bind(undefined, 1, "two")();
console.log(typeof result, result.length);
