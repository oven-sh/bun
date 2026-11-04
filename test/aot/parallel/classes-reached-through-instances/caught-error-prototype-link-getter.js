try {
  null.x;
} catch (e) {
  Object.setPrototypeOf(e.constructor.prototype, {
    get inherited() {
      return 5;
    },
  });
}
function read() {
  return new TypeError("made").inherited;
}
console.log(read());
