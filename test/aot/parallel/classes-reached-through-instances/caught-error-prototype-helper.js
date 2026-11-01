// Alone: the stores of other programs would be seen beside its own
function put(where, what) {
  where.kept = what;
}
try {
  null.x;
} catch (e) {
  put(e.constructor.prototype, true);
}
function read() {
  return TypeError.prototype.kept;
}
console.log(read());
