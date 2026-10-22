function target(first, second) {
  return second;
}
const result = target.apply(undefined, { length: 2, 0: 1, 1: "two" });
console.log(typeof result, result.length);
