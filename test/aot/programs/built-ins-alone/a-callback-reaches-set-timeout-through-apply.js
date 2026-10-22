function report(value) {
  console.log(typeof value, value + 1);
}
setTimeout.apply(null, [report, 0, 1.5]);
