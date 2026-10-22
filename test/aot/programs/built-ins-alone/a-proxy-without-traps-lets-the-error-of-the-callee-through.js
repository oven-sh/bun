function target() {
  throw new RangeError("out of range");
}
try {
  new Proxy(target, {})();
} catch (error) {
  console.log(error instanceof RangeError, error.message);
}
