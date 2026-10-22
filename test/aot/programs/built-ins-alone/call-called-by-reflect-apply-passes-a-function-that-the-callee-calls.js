function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
Reflect.apply(Function.prototype.call, target, [undefined, report]);
