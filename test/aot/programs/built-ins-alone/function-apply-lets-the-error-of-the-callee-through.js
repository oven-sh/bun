function target() {
  throw new RangeError("out of range");
}
try {
  target.apply(undefined, []);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
