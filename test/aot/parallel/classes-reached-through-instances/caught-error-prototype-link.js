// Alone: the stores of other programs would be seen beside its own
try {
  null.x;
} catch (e) {
  Object.setPrototypeOf(e.constructor.prototype, { inherited: 5 });
}
function read() {
  return new TypeError("made").inherited;
}
console.log(read());
