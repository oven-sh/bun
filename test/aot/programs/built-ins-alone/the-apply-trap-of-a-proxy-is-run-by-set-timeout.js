function inner(first, second) {
  return second + 1;
}
const proxy = new Proxy(inner, {
  apply(target, self, passed) {
    console.log("apply", typeof self, passed.length, typeof passed[1]);
    return target(...passed);
  },
});
setTimeout(proxy, 0, 1, 2.5);
