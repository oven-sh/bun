// Alone: the stores of other programs would be seen beside its own
try {
  null.x;
} catch (e) {
  Object.getOwnPropertyDescriptor(e.constructor, "prototype").value.kept = true;
}
function read() {
  return TypeError.prototype.kept;
}
console.log(read());
