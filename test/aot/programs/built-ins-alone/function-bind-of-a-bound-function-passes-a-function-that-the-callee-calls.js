function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
target.bind(undefined, report).bind(null)();
