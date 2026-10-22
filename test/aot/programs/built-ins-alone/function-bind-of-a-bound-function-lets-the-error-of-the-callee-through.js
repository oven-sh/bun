function target() {
  throw new RangeError("out of range");
}
try {
  target.bind(undefined).bind(null)();
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
