try {
  null.x;
} catch (e) {
  e.constructor.prototype.kept = true;
}
function read() {
  return new TypeError("made").kept;
}
console.log(read());
