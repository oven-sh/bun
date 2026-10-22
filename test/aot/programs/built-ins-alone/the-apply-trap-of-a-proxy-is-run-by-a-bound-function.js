function inner(first, second) {
  return second + 1;
}
const proxy = new Proxy(inner, {
  apply(target, self, passed) {
    console.log("apply", typeof self, passed.length, typeof passed[1]);
    return target(...passed);
  },
});
console.log(proxy.bind({}, 1)(2.5));
