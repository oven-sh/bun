try {
  null.x;
} catch (e) {
  Object.setPrototypeOf(e.constructor.prototype, { inherited: 5 });
}
function read() {
  return new TypeError("made").inherited;
}
console.log(read());
