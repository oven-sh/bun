function report(value) {
  console.log(typeof value, value + 1);
}
await Promise.prototype.then.call(Promise.resolve(1.5), report);
