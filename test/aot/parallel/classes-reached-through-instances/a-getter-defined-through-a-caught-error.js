try {
  null.x;
} catch (e) {
  Object.defineProperty(e.constructor, "extra", {
    get() {
      return 41;
    },
    configurable: true,
  });
}
function read() {
  return TypeError.extra;
}
console.log(read());
