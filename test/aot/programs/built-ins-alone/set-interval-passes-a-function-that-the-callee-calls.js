function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
  clearInterval(this);
}
setInterval(target, 1, report);
