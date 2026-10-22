function target(first, second) {
  return second;
}
const result = await Promise.try(target, 1, "two");
console.log(typeof result, result.length);
