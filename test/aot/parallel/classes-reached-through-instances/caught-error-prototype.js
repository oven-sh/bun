try {
  null.x;
} catch (e) {
  e.constructor.prototype.kept = true;
}
function read() {
  return TypeError.prototype.kept;
}
console.log(read());
