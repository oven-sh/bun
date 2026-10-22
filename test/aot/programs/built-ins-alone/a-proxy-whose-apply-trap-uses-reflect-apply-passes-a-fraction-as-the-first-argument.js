const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth, fifth) {
  console.log(typeof first, first + 1);
}
new Proxy(target, handler)(0.5, 1, 2, 3, 4);
