try {
  null.x;
} catch (e) {
  Object.getPrototypeOf(e.constructor).extra = 41;
}
function read() {
  return [Error.extra, RangeError.extra].join();
}
console.log(read());
