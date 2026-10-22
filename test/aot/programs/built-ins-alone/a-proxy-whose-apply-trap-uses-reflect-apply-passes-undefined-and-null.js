const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth, fifth) {
  console.log(first === undefined, typeof first);
  console.log(second === null, typeof second);
  console.log(third + 1, arguments.length);
}
new Proxy(target, handler)(undefined, null, 0.5);
