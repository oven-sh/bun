const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target() {
  return { made: 1.5 };
}
const result = new Proxy(target, handler)();
console.log(typeof result, result.made + 1);
