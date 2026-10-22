function target() {
  throw new RangeError("out of range");
}
try {
  await Promise.try(target);
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
