function target() {
  throw new RangeError("out of range");
}
try {
  Function.prototype.apply.call(target, undefined, []);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
