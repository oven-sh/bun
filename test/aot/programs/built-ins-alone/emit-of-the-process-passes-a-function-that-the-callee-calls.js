function report(value) {
  console.log(typeof value, value + 1);
}
function target(callback) {
  callback(1.5);
}
process.on("ready", target);
process.emit("ready", report);
