const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second) {
  return second;
}
const result = new Proxy(target, handler)(1, "two");
console.log(typeof result, result.length);
