function target() {
  throw new RangeError("out of range");
}
try {
  Reflect.apply(target, undefined, []);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
