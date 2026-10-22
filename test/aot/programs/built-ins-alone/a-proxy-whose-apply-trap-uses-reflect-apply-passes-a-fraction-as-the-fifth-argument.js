const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target(first, second, third, fourth, fifth) {
  console.log(typeof fifth, fifth + 1);
}
new Proxy(target, handler)(0, 1, 2, 3, 4.5);
