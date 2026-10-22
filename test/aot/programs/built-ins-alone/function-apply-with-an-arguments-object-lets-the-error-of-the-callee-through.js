let receiver;
function target() {
  throw new RangeError("out of range");
}
function relay() {
  return target.apply(receiver, arguments);
}
try {
  ((receiver = undefined), relay());
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
