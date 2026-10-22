let receiver;
function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
function relay() {
  return target.apply(receiver, arguments);
}
((receiver = undefined), relay(report));
