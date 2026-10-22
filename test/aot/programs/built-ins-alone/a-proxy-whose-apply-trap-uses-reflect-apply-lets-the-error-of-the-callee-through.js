const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function target() {
  throw new RangeError("out of range");
}
try {
  new Proxy(target, handler)();
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
