function target() {
  throw new RangeError("out of range");
}
try {
  target.call(undefined);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
