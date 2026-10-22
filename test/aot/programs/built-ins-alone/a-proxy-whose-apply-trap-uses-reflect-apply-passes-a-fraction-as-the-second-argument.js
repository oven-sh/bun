const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth, fifth) {
  console.log(typeof second, second + 1);
}
new Proxy(target, handler)(0, 1.5, 2, 3, 4);
