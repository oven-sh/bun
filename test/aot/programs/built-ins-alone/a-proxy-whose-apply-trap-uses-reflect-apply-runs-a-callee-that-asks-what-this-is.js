const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target() {
  console.log(typeof this, this === undefined);
}
new Proxy(target, handler)();
