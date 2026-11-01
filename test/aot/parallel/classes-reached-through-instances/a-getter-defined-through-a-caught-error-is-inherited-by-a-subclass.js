class Mine extends TypeError {}
try {
  null.x;
} catch (e) {
  Object.defineProperty(e.constructor, "extra", {
    get() {
      return 41;
    },
  });
}
function read() {
  return Mine.extra;
}
console.log(read());
