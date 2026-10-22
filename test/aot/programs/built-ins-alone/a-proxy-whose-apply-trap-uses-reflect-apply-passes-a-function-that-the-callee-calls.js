const handler = {
  apply(callee, self, passed) {
    return Reflect.apply(callee, self, passed);
  },
};
function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
new Proxy(target, handler)(report);
