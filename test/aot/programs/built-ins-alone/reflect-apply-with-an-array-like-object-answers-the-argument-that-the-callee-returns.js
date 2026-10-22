function target(first, second) {
  return second;
}
const result = Reflect.apply(target, undefined, { length: 2, 0: 1, 1: "two" });
console.log(typeof result, result.length);
