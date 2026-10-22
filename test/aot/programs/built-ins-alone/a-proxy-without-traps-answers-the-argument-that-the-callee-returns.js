function target(first, second) {
  return second;
}
const result = new Proxy(target, {})(1, "two");
console.log(typeof result, result.length);
